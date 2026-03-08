import logging
import time
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json
from services.process import ensure_session_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sessions"])

AVAILABLE_SEASONS = list(range(2024, 2029))

SESSION_NAME_TO_TYPE = {
    "Race": "R",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
}

# Cache: year -> (events_data, timestamp)
_events_cache: dict[int, tuple[dict, float]] = {}
_CACHE_TTL = 300  # 5 minutes


def _build_events(year: int) -> dict:
    """Build events response with availability based on session dates."""
    data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        return None

    data = deepcopy(data)
    events = data.get("events", [])
    now = datetime.now(timezone.utc)
    last_past_idx = None

    for i, evt in enumerate(events):
        has_past_session = False
        for session in evt.get("sessions", []):
            date_str = session.get("date_utc")
            if date_str:
                try:
                    session_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    if session_dt.tzinfo is None:
                        session_dt = session_dt.replace(tzinfo=timezone.utc)
                    # Available if the session date is in the past
                    session["available"] = session_dt < now
                    if session["available"]:
                        has_past_session = True
                except (ValueError, TypeError):
                    session["available"] = False
            else:
                session["available"] = False

        if has_past_session:
            evt["status"] = "available"
            last_past_idx = i
        else:
            evt["status"] = "future"

    # Mark the most recent past event as "latest"
    if last_past_idx is not None:
        events[last_past_idx]["status"] = "latest"

    return data


@router.get("/seasons")
async def list_seasons():
    now = datetime.now(timezone.utc)
    return {"seasons": [s for s in AVAILABLE_SEASONS if s <= now.year]}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    now = time.time()
    cached = _events_cache.get(year)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    data = _build_events(year)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No schedule data for {year}")

    _events_cache[year] = (data, now)
    return data


@router.get("/sessions/{year}/{round_num}")
async def get_session(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type: R, Q, S, FP1, FP2, FP3, SQ"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/info.json")
    if data is not None:
        return data

    # On-demand: try to process the session
    available = await ensure_session_data(year, round_num, type)
    if available:
        data = get_json(f"sessions/{year}/{round_num}/{type}/info.json")
        if data is not None:
            return data

    raise HTTPException(
        status_code=404,
        detail=f"Session data not available for {year} Round {round_num} ({type}).",
    )
