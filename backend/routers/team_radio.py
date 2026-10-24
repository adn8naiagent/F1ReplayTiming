import logging

from fastapi import APIRouter, Query, Response
from app_config import set_cache, validate_session
from services.storage import aget_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["team_radio"])


@router.get("/sessions/{year}/{round_num}/team-radio")
async def team_radio(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R", description="Session type"),
):
    validate_session(year, round_num, type)
    data = await aget_json(f"sessions/{year}/{round_num}/{type}/team_radio.json")
    set_cache(response, 300)
    # Sessions processed before team radio existed have none: an empty list,
    # not an error, so the replay page doesn't log a failed request.
    return {"clips": (data or {}).get("clips", [])}
