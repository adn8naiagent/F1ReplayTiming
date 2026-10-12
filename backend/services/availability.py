"""Per-season index of processed sessions and their stored size.

The session picker reads this one small file instead of listing every stored
object for the season, which with replay chunks runs to tens of thousands of
keys and took ~20s on R2. It's built from a listing the first time it's
missing, then kept current as sessions are processed or deleted.

Format: {"sessions": {"<round>/<type>": size_bytes, ...}}. A session is listed
only once its replay.json exists, the marker of a fully processed session.
"""

from __future__ import annotations

import logging
import threading

from services import storage

logger = logging.getLogger(__name__)

_lock = threading.RLock()


def _path(year: int) -> str:
    return f"seasons/{year}/availability.json"


def _save(year: int, sessions: dict[str, int]) -> None:
    storage.put_json(_path(year), {"sessions": dict(sorted(sessions.items()))})


def build(year: int) -> dict[str, int]:
    """Rebuild a season's index from a full storage listing."""
    totals: dict[str, int] = {}
    complete: set[str] = set()
    for key, size in storage.list_sizes(f"sessions/{year}").items():
        parts = key.split("/")
        # sessions/{year}/{round}/{type}/{file...}
        if len(parts) < 5:
            continue
        ident = f"{parts[2]}/{parts[3]}"
        totals[ident] = totals.get(ident, 0) + size
        if len(parts) == 5 and parts[4] == "replay.json":
            complete.add(ident)
    sessions = {ident: totals[ident] for ident in complete}
    _save(year, sessions)
    logger.info(f"Built availability index for {year} ({len(sessions)} sessions)")
    return sessions


def get(year: int) -> dict[str, int]:
    """{"<round>/<type>": size_bytes} for every processed session in a season."""
    data = storage.get_json(_path(year))
    if isinstance(data, dict) and isinstance(data.get("sessions"), dict):
        return data["sessions"]
    with _lock:
        return build(year)


def refresh_session(year: int, round_num: int, session_type: str) -> None:
    """Re-measure one session after it's been written or deleted."""
    prefix = f"sessions/{year}/{round_num}/{session_type}/"
    try:
        sizes = storage.list_sizes(prefix)
        with _lock:
            sessions = dict(get(year))
            ident = f"{round_num}/{session_type}"
            if prefix + "replay.json" in sizes:
                sessions[ident] = sum(sizes.values())
            else:
                sessions.pop(ident, None)
            _save(year, sessions)
    except Exception as e:
        logger.warning(f"Could not update availability for {prefix}: {e}")


def remove_sessions(idents: list[tuple[int, int, str]]) -> None:
    """Drop deleted sessions, one write per season."""
    by_year: dict[int, list[str]] = {}
    for year, round_num, session_type in idents:
        by_year.setdefault(year, []).append(f"{round_num}/{session_type}")
    for year, keys in by_year.items():
        try:
            with _lock:
                sessions = dict(get(year))
                for k in keys:
                    sessions.pop(k, None)
                _save(year, sessions)
        except Exception as e:
            logger.warning(f"Could not update availability for {year}: {e}")
