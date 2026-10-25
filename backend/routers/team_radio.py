import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response

from services.team_radio import AUDIO_NAME
from pydantic import BaseModel

from app_config import set_cache, validate_session
from services import caption_settings
from services.storage import aget_json, get_bytes

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
    clips = (data or {}).get("clips", [])
    # Audio kept on this server plays from here (F1 refuses some networks)
    for clip in clips:
        if clip.get("audio"):
            clip["url"] = f"/api/sessions/{year}/{round_num}/team-radio/audio/{clip['audio']}?type={type}"
    return {"clips": clips}


@router.get("/sessions/{year}/{round_num}/team-radio/audio/{name}")
async def team_radio_audio(
    year: int,
    round_num: int,
    name: str,
    type: str = Query("R", description="Session type"),
):
    """A team radio clip's audio, stored when the session was processed."""
    validate_session(year, round_num, type)
    if not AUDIO_NAME.fullmatch(name):
        raise HTTPException(status_code=404, detail="No such clip")
    found = await asyncio.to_thread(get_bytes, f"sessions/{year}/{round_num}/{type}/team_radio/{name}")
    if found is None:
        raise HTTPException(status_code=404, detail="No such clip")
    return Response(content=found[0], media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


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
        result = await asyncio.to_thread(
            caption_settings.save,
            whisper=sent.get("whisper_model"),
            ai_on=sent.get("ai_enabled"),
            ai=sent.get("ai_model"),
            **kwargs,
        )
    except caption_settings.CaptionSettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Start downloading a newly chosen model now, not at the next clip
    await asyncio.to_thread(caption_settings.download_selected)
    return await asyncio.to_thread(caption_settings.describe)
