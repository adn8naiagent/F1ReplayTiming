"""Simple site-wide passphrase authentication."""

from __future__ import annotations

import hashlib
import hmac
import os


def is_auth_enabled() -> bool:
    return os.environ.get("AUTH_ENABLED", "false").lower() in ("true", "1", "yes")


def _get_passphrase() -> str:
    return os.environ.get("AUTH_PASSPHRASE", "")


def generate_token(passphrase: str) -> str | None:
    expected = _get_passphrase()
    if not expected or passphrase != expected:
        return None
    return _make_token(expected)


def verify_token(token: str) -> bool:
    expected = _get_passphrase()
    if not expected or not token:
        return False
    return hmac.compare_digest(token, _make_token(expected))


def _make_token(passphrase: str) -> str:
    return hashlib.sha256(f"f1replay:{passphrase}".encode()).hexdigest()
