"""Runtime settings read from the environment, and shared request validation."""

from __future__ import annotations

import os
import re

from fastapi import HTTPException

SESSION_TYPES = ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3")

MIN_YEAR = 2018
MAX_YEAR = 2035
MAX_ROUND = 30

_DRIVER_RE = re.compile(r"^[A-Z]{3}$")


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("true", "1", "yes", "on")


def is_public_mode() -> bool:
    """Public mode turns off admin and processing features for a shared site."""
    return _flag("PUBLIC_MODE", False)


def retention_sweep_enabled() -> bool:
    return _flag("RETENTION_SWEEP_ENABLED", True)


def replay_player() -> str:
    """Which replay player the frontend uses: "static" (default) or "websocket"."""
    value = os.environ.get("REPLAY_PLAYER", "static").strip().lower()
    return value if value in ("static", "websocket") else "static"


def origin_secret() -> str:
    return os.environ.get("ORIGIN_SECRET", "").strip()


def photo_sync_available() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY")) and not is_public_mode()


def live_f1tv_auth() -> bool:
    """Sign in to the live stream with an F1 TV account (via FastF1) to get
    car positions and telemetry. Needs an F1 TV Access subscription or higher."""
    return _flag("LIVE_F1TV_AUTH", False) and not is_public_mode()


def set_cache(response, seconds: int, immutable: bool = False) -> None:
    """Cache-Control for read-only data.

    Shared caches (Cloudflare) may only store it when the site has no
    passphrase; behind a passphrase it stays in the viewer's own browser.
    """
    from auth import is_auth_enabled

    scope = "private" if is_auth_enabled() else "public"
    value = f"{scope}, max-age={seconds}"
    if immutable:
        value += ", immutable"
    response.headers["Cache-Control"] = value


def validate_session(year: int, round_num: int, session_type: str) -> None:
    """Reject out-of-range sessions before they reach storage paths or FastF1."""
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise HTTPException(status_code=400, detail=f"Unsupported year: {year}")
    if not 1 <= round_num <= MAX_ROUND:
        raise HTTPException(status_code=400, detail=f"Unsupported round: {round_num}")
    if session_type not in SESSION_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown session type: {session_type}")


def is_valid_session(year: int, round_num: int, session_type: str) -> bool:
    try:
        validate_session(year, round_num, session_type)
        return True
    except HTTPException:
        return False


def validate_driver(driver: str) -> None:
    if not _DRIVER_RE.match(driver or ""):
        raise HTTPException(status_code=400, detail=f"Invalid driver code: {driver}")
