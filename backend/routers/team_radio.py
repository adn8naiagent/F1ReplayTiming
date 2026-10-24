import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app_config import set_cache, validate_session
from services import caption_settings
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


# Caption settings for this server (Settings > Team Radio). Self-hosted only:
# blocked in public mode (main.py).

class CaptionSettingsUpdate(BaseModel):
    whisper_model: Optional[str] = None
    # Sent as null for "the same as replays"; left out to leave unchanged
    live_whisper_model: Optional[str] = None
    ai_enabled: Optional[bool] = None
    ai_model: Optional[str] = None


@router.get("/captions/settings")
async def caption_settings_get():
    return await asyncio.to_thread(caption_settings.describe)


@router.put("/captions/settings")
async def caption_settings_put(body: CaptionSettingsUpdate):
    sent = body.model_dump(exclude_unset=True)
    kwargs = {}
    if "live_whisper_model" in sent:
        kwargs["live_whisper"] = sent["live_whisper_model"]
    try:
        return await asyncio.to_thread(
            caption_settings.save,
            whisper=sent.get("whisper_model"),
            ai_on=sent.get("ai_enabled"),
            ai=sent.get("ai_model"),
            **kwargs,
        )
    except caption_settings.CaptionSettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
