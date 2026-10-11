import logging

from fastapi import APIRouter, Query, HTTPException, Response
from app_config import set_cache, validate_session
from services.storage import aget_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["results"])


@router.get("/sessions/{year}/{round_num}/results")
async def race_results(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R", description="Session type"),
):
    validate_session(year, round_num, type)
    data = await aget_json(f"sessions/{year}/{round_num}/{type}/results.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Results not available for this session.",
        )
    set_cache(response, 300)
    return {"results": data}
