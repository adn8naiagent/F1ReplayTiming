import logging

from fastapi import APIRouter, Query, HTTPException
from services.f1_data import get_race_results

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["results"])


@router.get("/sessions/{year}/{round_num}/results")
async def race_results(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    try:
        results = await get_race_results(year, round_num, type)
        return {"results": results}
    except Exception as e:
        logger.error(f"Failed to load results {year}/{round_num}/{type}: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Results not available for this session.",
        )
