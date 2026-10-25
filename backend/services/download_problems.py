"""Sessions that failed to download, for the home page (self-hosted only).

Background downloads (AUTO_PRECOMPUTE) and reprocesses run without anyone
watching, so their failures are kept here until the session next downloads.
Kept per server (DATA_DIR/config/download_problems.json), not in shared
storage: each server's network can be refused on its own.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.Lock()


def _path() -> Path:
    data_dir = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))
    return data_dir / "config" / "download_problems.json"


def _read() -> dict[str, dict[str, Any]]:
    try:
        return json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}


def _write(data: dict[str, dict[str, Any]]) -> None:
    path = _path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
    except OSError as e:
        logger.warning(f"Couldn't save download problems: {e}")


def _key(year: int, round_num: int, session_type: str) -> str:
    return f"{year}_{round_num}_{session_type}"


def record(year: int, round_num: int, session_type: str, message: str) -> None:
    with _lock:
        data = _read()
        data[_key(year, round_num, session_type)] = {
            "year": year,
            "round": round_num,
            "type": session_type,
            "message": message[:500],
            "time": time.time(),
        }
        _write(data)


def clear(year: int, round_num: int, session_type: str) -> None:
    with _lock:
        data = _read()
        if data.pop(_key(year, round_num, session_type), None) is not None:
            _write(data)


def all_problems() -> list[dict[str, Any]]:
    """Newest first."""
    with _lock:
        return sorted(_read().values(), key=lambda p: p["time"], reverse=True)
