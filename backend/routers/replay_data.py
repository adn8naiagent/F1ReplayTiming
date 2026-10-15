"""Static replay files for the browser player.

GET /api/sessions/{year}/{round}/replay       manifest, or progress while it's prepared
GET /api/data/sessions/.../replay/{version}/chunk-NNNN.json   one chunk, served as stored

Chunk URLs include the version, so they never change and can be cached for a
year; without a passphrase Cloudflare can serve them without reaching the server.
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from app_config import set_cache, validate_session
from services import replay_chunks, storage
from services.process import clear_prepare_status, get_prepare_status, start_prepare

router = APIRouter(prefix="/api", tags=["replay-data"])

_VERSION_RE = re.compile(r"^\d{10,16}$")
_CHUNK_RE = re.compile(r"^chunk-\d{4}\.json$")


@router.get("/sessions/{year}/{round_num}/replay")
async def replay_manifest(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R"),
):
    validate_session(year, round_num, type)
    manifest = await asyncio.to_thread(replay_chunks.get_manifest, year, round_num, type)
    if manifest:
        set_cache(response, 60)
        return {"state": "ready", "manifest": manifest}

    status = get_prepare_status(year, round_num, type)
    if status["state"] in ("idle", "done"):
        status = start_prepare(year, round_num, type)
    elif status["state"] in ("error", "unavailable"):
        # Report the failure once; the next page load tries again.
        clear_prepare_status(year, round_num, type)
        if status["state"] in ("unavailable", "rate_limited"):
            # Expected condition, not a server fault: tell the client when to retry.
            retry_after = int(status.get("retry_after") or 0)
            content = {
                "state": status["state"],
                "message": status["message"],
                "detail": status["message"],
                "reason": status.get("reason", status["state"]),
                "retry_after": retry_after,
            }
            headers = {"Retry-After": str(retry_after)} if retry_after else {}
            return JSONResponse(status_code=503, content=content, headers=headers)
        return JSONResponse(status_code=500, content={"state": status["state"], "message": status["message"]})

    response.headers["Cache-Control"] = "no-store"
    response.status_code = 202
    return {"state": status["state"], "message": status["message"]}


@router.get("/data/sessions/{year}/{round_num}/{session_type}/replay/{version}/{name}")
async def replay_chunk(year: int, round_num: int, session_type: str, version: str, name: str):
    validate_session(year, round_num, session_type)
    if not _VERSION_RE.match(version) or not _CHUNK_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid replay file")

    path = f"{replay_chunks.replay_prefix(year, round_num, session_type)}/{version}/{name}"
    found = await asyncio.to_thread(storage.get_bytes, path)
    if found is None:
        raise HTTPException(status_code=404, detail="Replay file not found")

    body, gzipped = found
    headers = {}
    if gzipped:
        headers["Content-Encoding"] = "gzip"
    response = Response(content=body, media_type="application/json", headers=headers)
    set_cache(response, 31536000, immutable=True)
    return response
