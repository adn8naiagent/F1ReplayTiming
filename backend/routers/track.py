import asyncio
import logging

from fastapi import APIRouter, Query, HTTPException, Response
from app_config import set_cache, validate_session
from services.storage import get_json, aget_json
from services.process import ensure_session_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["track"])


def _find_track(year: int, round_num: int, session_type: str) -> dict | None:
    data = get_json(f"sessions/{year}/{round_num}/{session_type}/track.json")
    if data is not None:
        return data

    # Fast fallback: try other session types or previous years BEFORE
    # triggering slow FastF1 processing (track outlines rarely change)
    for alt_type in ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3"):
        if alt_type == session_type:
            continue
        data = get_json(f"sessions/{year}/{round_num}/{alt_type}/track.json")
        if data is not None:
            logger.info(f"Track fallback: using {year}/{round_num}/{alt_type} for {session_type}")
            return data

    for prev_year in range(year - 1, year - 4, -1):
        for alt_type in ("R", "Q"):
            data = get_json(f"sessions/{prev_year}/{round_num}/{alt_type}/track.json")
            if data is not None:
                logger.info(f"Track fallback: using {prev_year}/{round_num}/{alt_type} for {year}/{round_num}/{session_type}")
                return data
    return None


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R", description="Session type"),
):
    validate_session(year, round_num, type)
    data = await asyncio.to_thread(_find_track, year, round_num, type)
    if data is not None:
        set_cache(response, 300)
        return data

    # On-demand: try to process the session via FastF1 (last resort)
    available = await ensure_session_data(year, round_num, type)
    if available:
        data = await aget_json(f"sessions/{year}/{round_num}/{type}/track.json")
        if data is not None:
            return data

    raise HTTPException(
        status_code=404,
        detail="Track data not available for this session.",
    )
