import logging

from fastapi import APIRouter, Query, HTTPException
from services.f1_data import get_lap_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["laps"])


@router.get("/sessions/{year}/{round_num}/laps")
async def lap_data(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    try:
        laps = await get_lap_data(year, round_num, type)
        return {"laps": laps}
    except Exception as e:
        logger.error(f"Failed to load lap data {year}/{round_num}/{type}: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Lap data not available for this session.",
        )
