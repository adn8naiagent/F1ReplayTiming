import logging

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["laps"])


@router.get("/sessions/{year}/{round_num}/laps")
async def lap_data(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/laps.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Lap data not available for this session.",
        )
    return {"laps": data}
