import logging
import time
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json, exists, list_keys

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
    """Build events response with availability checked against storage."""
    data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        return None

    data = deepcopy(data)
    events = data.get("events", [])

    # Single scan to find all replay.json files for this year
    all_keys = set(list_keys(f"sessions/{year}"))
    last_available_idx = None

    for i, evt in enumerate(events):
        round_num = evt["round_number"]
        has_data = False
        for session in evt.get("sessions", []):
            st = SESSION_NAME_TO_TYPE.get(session["name"])
            if st and f"sessions/{year}/{round_num}/{st}/replay.json" in all_keys:
                session["available"] = True
                has_data = True
            else:
                session["available"] = False

        if has_data:
            evt["status"] = "available"
            last_available_idx = i
        else:
            evt["status"] = "future"

    if last_available_idx is not None:
        events[last_available_idx]["status"] = "latest"

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
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Session data not available for {year} Round {round_num} ({type}).",
        )
    return data
