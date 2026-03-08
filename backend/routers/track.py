import logging

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json
from services.process import ensure_session_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["track"])


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/track.json")
    if data is not None:
        return data

    # On-demand: try to process the session
    available = await ensure_session_data(year, round_num, type)
    if available:
        data = get_json(f"sessions/{year}/{round_num}/{type}/track.json")
        if data is not None:
            return data

    raise HTTPException(
        status_code=404,
        detail="Track data not available for this session.",
    )
