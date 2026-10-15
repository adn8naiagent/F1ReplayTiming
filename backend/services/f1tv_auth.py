"""F1 TV subscription token storage and verification (self-hosted only).

The user signs in on formula1.com and gives us the ``loginSession`` cookie
value (or the ``subscriptionToken`` inside it). The token is an RS256 JWT
that we verify against F1's published keys, then keep in a local file. It is
never written to R2, which may be shared between deployments.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger(__name__)

JWKS_URL = "https://api.formula1.com/static/jwks.json"
_JWKS_TTL = 3600.0

_jwks_cache: tuple[float, dict] | None = None
_token: str | None = None
_loaded = False


class F1TVTokenError(ValueError):
    pass


def _token_file() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return Path(os.environ.get("F1TV_TOKEN_FILE", data_dir / "f1tv" / "token"))


def extract_token(value: str) -> str:
    """Accept a raw JWT, a ``loginSession`` cookie value (URL-encoded JSON)
    or that JSON itself, and return the subscription token."""
    value = value.strip().strip('"')
    if value.startswith("loginSession="):
        value = value[len("loginSession="):]
    if value.count(".") == 2 and not value.startswith(("{", "%7B")):
        return value
    try:
        parsed = json.loads(urllib.parse.unquote(value))
    except (json.JSONDecodeError, TypeError):
        raise F1TVTokenError("Not a subscription token or loginSession cookie value")
    token = (parsed.get("data") or {}).get("subscriptionToken") if isinstance(parsed, dict) else None
    if not token:
        raise F1TVTokenError("No subscriptionToken found in the loginSession value")
    return token


def _jwks() -> dict:
    global _jwks_cache
    now = time.time()
    if _jwks_cache and now - _jwks_cache[0] < _JWKS_TTL:
        return _jwks_cache[1]
    resp = httpx.get(JWKS_URL, timeout=10)
    resp.raise_for_status()
    _jwks_cache = (now, resp.json())
    return _jwks_cache[1]


def verify(token: str) -> dict[str, Any]:
    """Verify the token's signature and expiry. Returns its claims."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as e:
        raise F1TVTokenError(f"Malformed token: {e}")
    key = next((k for k in _jwks().get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise F1TVTokenError("Token signed with an unknown key")
    try:
        return jwt.decode(
            token,
            key=RSAAlgorithm.from_jwk(key),
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise F1TVTokenError("Token has expired, sign in again")
    except jwt.PyJWTError as e:
        raise F1TVTokenError(f"Token verification failed: {e}")


def _load() -> None:
    global _token, _loaded
    if _loaded:
        return
    _loaded = True
    path = _token_file()
    if path.is_file():
        _token = path.read_text().strip() or None


def save(token: str) -> dict[str, Any]:
    global _token, _loaded
    claims = verify(token)
    path = _token_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    os.chmod(path, 0o600)
    _token, _loaded = token, True
    logger.info("F1 TV token saved (expires %s)", claims.get("exp"))
    return claims


def clear() -> None:
    global _token, _loaded
    _token, _loaded = None, True
    try:
        _token_file().unlink()
    except FileNotFoundError:
        pass


def get_token() -> str | None:
    """The stored token if it hasn't expired, else None. Doesn't hit the
    network, so it is safe to call from the live timing client."""
    _load()
    if not _token:
        return None
    try:
        exp = jwt.decode(_token, options={"verify_signature": False}).get("exp")
    except jwt.PyJWTError:
        return None
    if exp and exp < time.time():
        return None
    return _token


def status() -> dict[str, Any]:
    _load()
    if not _token:
        return {"signed_in": False}
    try:
        claims = verify(_token)
        error = None
    except F1TVTokenError as e:
        claims = jwt.decode(_token, options={"verify_signature": False})
        error = str(e)
    except httpx.HTTPError as e:
        claims = jwt.decode(_token, options={"verify_signature": False})
        error = f"Couldn't reach F1 to check the token: {e}"
    return {
        "signed_in": True,
        "valid": error is None,
        "error": error,
        "expires_at": claims.get("exp"),
        "product": claims.get("SubscribedProduct"),
        "subscription_status": claims.get("SubscriptionStatus"),
        # Claim names only (no values), to see what F1 puts in the token.
        "claim_names": sorted(claims.keys()),
    }
