"""The stored season calendar (seasons/<year>/schedule.json), kept fresh daily."""

from __future__ import annotations

import logging
import threading
import time

from services import storage

logger = logging.getLogger(__name__)

REFRESH_AFTER = 24 * 60 * 60

_refreshing: set[int] = set()
_refreshing_lock = threading.Lock()


def schedule_path(year: int) -> str:
    return f"seasons/{year}/schedule.json"


def refresh_schedule(year: int) -> list[dict]:
    """Fetch the calendar from FastF1 and write it to storage."""
    from services.f1_data import _fetch_schedule_sync, _get_season_events_sync

    _fetch_schedule_sync(year, force=True)
    events = _get_season_events_sync(year)
    storage.put_json(
        schedule_path(year),
        {"year": year, "events": events, "refreshed_at": int(time.time())},
    )
    logger.info(f"Refreshed {year} schedule in storage ({len(events)} events)")
    return events


def is_stale(data: dict | None) -> bool:
    """True if a stored calendar is older than a day, or predates refresh tracking."""
    if not data:
        return True
    refreshed = data.get("refreshed_at")
    return not isinstance(refreshed, (int, float)) or time.time() - refreshed > REFRESH_AFTER


def refresh_in_background(year: int, on_done=None) -> None:
    """Refresh without holding up the request that noticed the calendar is stale."""
    with _refreshing_lock:
        if year in _refreshing:
            return
        _refreshing.add(year)

    def run():
        try:
            refresh_schedule(year)
            if on_done:
                on_done()
        except Exception as e:
            logger.warning(f"Background schedule refresh for {year} failed: {e}")
        finally:
            with _refreshing_lock:
                _refreshing.discard(year)

    threading.Thread(target=run, name=f"schedule-refresh-{year}", daemon=True).start()
