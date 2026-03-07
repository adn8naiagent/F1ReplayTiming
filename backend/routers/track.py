import logging

from fastapi import APIRouter, Query, HTTPException
from services.f1_data import get_track_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["track"])


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    try:
        data = await get_track_data(year, round_num, type)
        return data
    except Exception as e:
        logger.error(f"Failed to load track data {year}/{round_num}/{type}: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Track data not available for this session. It may not have finished yet.",
        )
