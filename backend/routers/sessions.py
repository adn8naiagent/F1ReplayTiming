import logging

from fastapi import APIRouter, Query, HTTPException
from services.f1_data import get_season_events, get_session_info

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sessions"])

AVAILABLE_SEASONS = list(range(2018, 2027))


@router.get("/seasons")
async def list_seasons():
    return {"seasons": AVAILABLE_SEASONS}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    try:
        events = await get_season_events(year)
        return {"year": year, "events": events}
    except Exception as e:
        logger.error(f"Failed to load events for {year}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load {year} season data")


@router.get("/sessions/{year}/{round_num}")
async def get_session(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type: R, Q, S, FP1, FP2, FP3, SQ"),
):
    try:
        info = await get_session_info(year, round_num, type)
        return info
    except Exception as e:
        logger.error(f"Failed to load session {year}/{round_num}/{type}: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Session data not available for {year} Round {round_num} ({type}). It may not have finished yet.",
        )
