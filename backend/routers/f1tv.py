"""F1 TV video endpoints. Self-hosted only: blocked in public mode.

Sign-in lives in routers/f1_account.py; the token comes from services.f1_account."""

from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from services import f1tv_video

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/f1tv", tags=["f1tv"])


class PlayRequest(BaseModel):
    content: str  # content id or F1 TV link
    channel_id: Optional[str] = None


def _error(e: f1tv_video.F1TVError) -> JSONResponse:
    status = e.status if e.status and 400 <= e.status < 600 else 502
    return JSONResponse(status_code=status, content={"detail": str(e), "f1tv_status": e.status, "f1tv_body": e.body})


@router.get("/replay-start")
async def replay_start(year: int, round: int, type: str):
    """The real time (epoch seconds) at a replay's 0:00, to line Broadcast
    video up with the timing."""
    from services.storage import aget_json

    info = await aget_json(f"sessions/{year}/{round}/{type}/info.json") or {}
    if info.get("replay_start_utc"):
        return {"replay_start_utc": info["replay_start_utc"]}
    # Sessions processed before it was stored: team radio clips carry both
    # their replay time and their real time
    from services.team_radio import parse_utc
    from datetime import timezone
    import statistics

    clips = (await aget_json(f"sessions/{year}/{round}/{type}/team_radio.json") or {}).get("clips") or []
    starts = []
    for c in clips:
        utc = parse_utc((c.get("utc") or "").rstrip("Z"))
        if utc is not None and c.get("t") is not None:
            starts.append(utc.replace(tzinfo=timezone.utc).timestamp() - float(c["t"]))
    if not starts:
        raise HTTPException(status_code=404, detail="Reprocess this session to sync Broadcast automatically")
    return {"replay_start_utc": statistics.median(starts)}


@router.get("/find")
async def find(year: int, round: int, type: str):
    """The F1 TV replay of a session, so Broadcast can open it without a link."""
    try:
        found = await f1tv_video.find_replay(year, round, type)
    except f1tv_video.F1TVError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e))
    if not found:
        raise HTTPException(status_code=404, detail="No F1 TV replay found for this session yet")
    return found


@router.get("/content")
async def content(q: str):
    try:
        return await f1tv_video.content(f1tv_video.parse_content_id(q))
    except f1tv_video.F1TVError as e:
        return _error(e)


@router.post("/play")
async def play(body: PlayRequest):
    try:
        return await f1tv_video.play(f1tv_video.parse_content_id(body.content), body.channel_id)
    except f1tv_video.F1TVError as e:
        return _error(e)


@router.post("/license/{pid}")
async def license(pid: str, request: Request):
    try:
        status, data, content_type = await f1tv_video.license(pid, await request.body())
    except f1tv_video.F1TVError as e:
        return _error(e)
    if status >= 400:
        logger.warning("F1 TV licence request returned %s", status)
    return Response(content=data, status_code=status, media_type=content_type)


@router.get("/relay/{pid}/{host}/{path:path}")
async def relay(pid: str, host: str, path: str, request: Request):
    """Pass manifest and segment requests through for the user's own playback,
    for when the CDN won't serve this page directly. Only hosts that came from
    F1 TV's own play response are allowed."""
    try:
        pb = f1tv_video.get_playback(pid)
    except f1tv_video.F1TVError as e:
        return _error(e)
    if not f1tv_video.relay_allowed(pb, host):
        raise HTTPException(status_code=403, detail=f"Host {host} isn't part of this playback")
    url = f"https://{host}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    headers = {"User-Agent": f1tv_video.USER_AGENT}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]

    client = httpx.AsyncClient(timeout=30, follow_redirects=True)
    upstream = await client.send(client.build_request("GET", url, headers=headers), stream=True)

    async def body():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    passthrough = {k: v for k, v in upstream.headers.items() if k.lower() in ("content-type", "content-range", "accept-ranges")}
    return StreamingResponse(body(), status_code=upstream.status_code, headers=passthrough)
