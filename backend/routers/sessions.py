import logging

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sessions"])

AVAILABLE_SEASONS = list(range(2024, 2029))


@router.get("/seasons")
async def list_seasons():
    return {"seasons": AVAILABLE_SEASONS}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        raise HTTPException(status_code=404, detail=f"No schedule data for {year}")
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
