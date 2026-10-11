import logging

from fastapi import APIRouter, Query, HTTPException, Response
from app_config import set_cache, validate_session
from services.storage import aget_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["laps"])


@router.get("/sessions/{year}/{round_num}/laps")
async def lap_data(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R", description="Session type"),
):
    validate_session(year, round_num, type)
    data = await aget_json(f"sessions/{year}/{round_num}/{type}/laps.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Lap data not available for this session.",
        )
    set_cache(response, 300)
    return {"laps": data}
