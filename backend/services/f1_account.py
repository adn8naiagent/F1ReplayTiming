"""F1 TV account sign-in for downloading session data (self-hosted only).

Since 15 October 2026 F1's timing archive needs an F1 TV login. FastF1 3.9
signs in with an F1 account and sends the F1 TV subscription token with every
livetiming request. This module is the only place that touches FastF1's
sign-in internals (it's an alpha), so changes there stay in one file.

- The token lives in DATA_DIR/f1tv/token.json (FastF1's own token format).
- "Keep me signed in" stores the email and password encrypted in
  DATA_DIR/f1tv/credentials.enc, so the token (about 4 days) renews by itself.
  The key comes from F1TV_SECRET_KEY, or a key file kept outside DATA_DIR.
  The app has to decrypt it unattended, so this protects a copied data folder
  or backup, not a fully compromised server.
- F1_USERNAME / F1_PASSWORD in the environment also work, and win over saved
  credentials.
- Nothing here is ever written to R2, which may be shared between installs.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import tempfile
import threading
import urllib.parse
from pathlib import Path
from typing import Any

import jwt
import requests
from cryptography.fernet import Fernet, InvalidToken
from fastf1 import req as f1req
from fastf1.exceptions import F1AuthError
from fastf1.internals import f1account
from fastf1.internals.f1account.login import Credentials, login
from fastf1.internals.f1account.tokens import SubscriptionToken, TokenStore

logger = logging.getLogger(__name__)

# (connect, read) timeout for FastF1's data requests, which otherwise have
# none: a stalled download (FastF1 #982) would block processing forever.
REQUEST_TIMEOUT = (10, 60)

ENV_USERNAME = "F1_USERNAME"
ENV_PASSWORD = "F1_PASSWORD"


class F1AccountError(Exception):
    """Processing can't download from F1: not signed in, or F1 refused us.
    The message is shown to the user as is."""


SIGN_IN_NEEDED = (
    "F1 now requires an F1 TV subscription for timing data. "
    "Sign in to your F1 TV account under Settings → F1 TV."
)
SERVER_STALLED = "F1's servers didn't respond. Try again later."


# --- Paths and encryption -------------------------------------------------

def _dir() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return data_dir / "f1tv"


def _token_path() -> Path:
    return _dir() / "token.json"


def _credentials_path() -> Path:
    return _dir() / "credentials.enc"


def _key_path() -> Path:
    # Outside DATA_DIR on purpose, so a copy of the data folder alone can't
    # decrypt the saved password.
    return Path.home() / ".config" / "f1replaytiming" / "f1tv.key"


def _fernet(create: bool) -> Fernet | None:
    secret = os.environ.get("F1TV_SECRET_KEY", "").strip()
    if secret:
        # Any string works: derive a Fernet key from it.
        return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))
    path = _key_path()
    if path.is_file():
        return Fernet(path.read_bytes().strip())
    if not create:
        return None
    key = Fernet.generate_key()
    _write_private(path, key)
    return Fernet(key)


def _write_private(path: Path, data: bytes) -> None:
    """Write a file only the owner can read, atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")  # mode 0600
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def _save_credentials(email: str, password: str) -> None:
    f = _fernet(create=True)
    payload = json.dumps({"email": email, "password": password}).encode()
    _write_private(_credentials_path(), f.encrypt(payload))


def _load_credentials() -> Credentials | None:
    path = _credentials_path()
    if not path.is_file():
        return None
    f = _fernet(create=False)
    if f is None:
        logger.warning("Saved F1 TV credentials can't be read: the encryption key is missing. Sign in again.")
        return None
    try:
        data = json.loads(f.decrypt(path.read_bytes()))
        return Credentials(data["email"], data["password"])
    except (InvalidToken, ValueError, KeyError):
        logger.warning("Saved F1 TV credentials can't be decrypted (the key changed?). Sign in again.")
        return None


def _credentials() -> tuple[Credentials | None, str | None]:
    """Credentials for renewing the token, and where they came from."""
    user, pw = os.environ.get(ENV_USERNAME), os.environ.get(ENV_PASSWORD)
    if user and pw:
        return Credentials(user, pw), "env"
    saved = _load_credentials()
    return (saved, "saved") if saved else (None, None)


# --- FastF1 wiring --------------------------------------------------------

_configured = False
_config_lock = threading.Lock()
_timeouts = 0
_timeouts_lock = threading.Lock()


def _authenticate() -> SubscriptionToken:
    """Renew the token from stored credentials. Never prompts: in the server
    a prompt would block a worker thread on the terminal."""
    creds, _source = _credentials()
    if creds is None:
        raise F1AuthError("No F1 TV sign-in available")
    return login(creds)


def configure() -> None:
    """Point FastF1 at our token file and renewal, and add request timeouts.
    Safe to call more than once."""
    global _configured
    with _config_lock:
        if _configured:
            return
        manager = f1account.token_manager
        manager._store = TokenStore(_token_path())
        manager._authenticate = _authenticate
        manager._token = None

        original_send = f1req._SessionWithRateLimiting.send

        def send_with_timeout(self, request, **kwargs):
            global _timeouts
            if kwargs.get("timeout") is None:
                kwargs["timeout"] = REQUEST_TIMEOUT
            try:
                return original_send(self, request, **kwargs)
            except requests.Timeout:
                with _timeouts_lock:
                    _timeouts += 1
                logger.warning(f"Request to F1 timed out: {request.url}")
                raise

        f1req._SessionWithRateLimiting.send = send_with_timeout
        _configured = True


def timeout_count() -> int:
    """Number of timed-out requests so far, to tell whether a load stalled."""
    return _timeouts


# --- Public API -----------------------------------------------------------

def _stored_token() -> SubscriptionToken | None:
    return TokenStore(_token_path()).load()


def _claims(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return {}


def status() -> dict[str, Any]:
    """Sign-in state for the settings page. Never includes the token."""
    token = _stored_token()
    _creds, source = _credentials()
    claims = _claims(token.value) if token else {}
    valid = bool(token and token.is_valid())
    return {
        "signed_in": valid or source is not None,
        "token_valid": valid,
        "expires_at": token.expires_at if token else None,
        "product": claims.get("SubscribedProduct"),
        "subscription_status": claims.get("SubscriptionStatus"),
        # "env", "saved" or None: whether the token renews by itself
        "renews": source,
        "email": _masked_email(source),
        # Without it, a saved sign-in depends on a key file that Docker
        # rebuilds and file-wiping hosts lose.
        "secret_key_set": bool(os.environ.get("F1TV_SECRET_KEY", "").strip()),
    }


def _masked_email(source: str | None) -> str | None:
    creds, _ = _credentials() if source else (None, None)
    if not creds:
        return None
    name, _, domain = creds.username.partition("@")
    return f"{name[:2]}{'•' * max(1, len(name) - 2)}@{domain}" if domain else None


def ready() -> bool:
    """Whether a download can authenticate: a valid token, or credentials
    to get one."""
    token = _stored_token()
    if token and token.is_valid():
        return True
    return _credentials()[0] is not None


def sign_in_password(email: str, password: str, remember: bool) -> dict[str, Any]:
    configure()
    try:
        token = login(Credentials(email.strip(), password))
    except F1AuthError as e:
        raise F1AccountError(str(e)) from e
    _store(token)
    if remember:
        _save_credentials(email.strip(), password)
    else:
        _delete(_credentials_path())
    logger.info("Signed in to F1 TV (keep signed in: %s)", remember)
    return status()


def sign_in_token(value: str) -> dict[str, Any]:
    """Sign in with a pasted loginSession cookie value or raw token."""
    configure()
    token = SubscriptionToken.from_jwt(_extract_token(value))
    if not token.is_valid():
        raise F1AccountError("That token has expired. Copy a fresh one after signing in to F1 TV.")
    _store(token)
    logger.info("Signed in to F1 TV with a pasted token")
    return status()


def sign_out() -> dict[str, Any]:
    f1account.token_manager._token = None
    _delete(_token_path())
    _delete(_credentials_path())
    logger.info("Signed out of F1 TV")
    return status()


def _store(token: SubscriptionToken) -> None:
    TokenStore(_token_path()).save(token)
    f1account.token_manager._token = token


def _delete(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _extract_token(value: str) -> str:
    """Accept a raw JWT, a loginSession cookie value (URL-encoded JSON) or
    that JSON itself, and return the subscription token."""
    value = value.strip().strip('"')
    if value.startswith("loginSession="):
        value = value[len("loginSession="):]
    if value.count(".") == 2 and not value.startswith(("{", "%7B")):
        return value
    try:
        parsed = json.loads(urllib.parse.unquote(value))
    except (json.JSONDecodeError, TypeError):
        raise F1AccountError("That isn't a loginSession cookie value or token.")
    token = (parsed.get("data") or {}).get("subscriptionToken") if isinstance(parsed, dict) else None
    if not token:
        raise F1AccountError("No subscription token found in that loginSession value.")
    return token


def get_token() -> str | None:
    """A valid subscription token for live timing and video, renewing from
    stored credentials if it has expired. None if not signed in."""
    configure()
    try:
        return f1account.token_manager.get().value
    except F1AuthError as e:
        logger.info(f"No F1 TV token available: {e}")
        return None


def require_ready() -> None:
    """Raise F1AccountError if a download couldn't authenticate."""
    if not ready():
        raise F1AccountError(SIGN_IN_NEEDED)
