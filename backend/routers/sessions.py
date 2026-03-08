import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json, exists

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


@router.get("/seasons")
async def list_seasons():
    now = datetime.now(timezone.utc)
    return {"seasons": [s for s in AVAILABLE_SEASONS if s <= now.year]}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        raise HTTPException(status_code=404, detail=f"No schedule data for {year}")

    # Recompute availability based on what actually exists in storage
    events = data.get("events", [])
    last_available_idx = None

    for i, evt in enumerate(events):
        round_num = evt["round_number"]
        has_data = False
        for session in evt.get("sessions", []):
            st = SESSION_NAME_TO_TYPE.get(session["name"])
            if st and exists(f"sessions/{year}/{round_num}/{st}/replay.json"):
                session["available"] = True
                has_data = True
            else:
                session["available"] = False

        if has_data:
            evt["status"] = "available"
            last_available_idx = i
        else:
            evt["status"] = "future"

    # Mark the most recent available event as "latest"
    if last_available_idx is not None:
        events[last_available_idx]["status"] = "latest"

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
