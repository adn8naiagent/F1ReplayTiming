import asyncio
import logging
import math

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.storage import get_json
from services.process import ensure_session_data_ws

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

# In-memory cache for replay frames loaded from R2
_replay_cache: dict[str, list[dict]] = {}


def _sanitize_frame(frame: dict) -> dict:
    """Replace NaN/Infinity floats with None to produce valid JSON."""
    for drv in frame.get("drivers", []):
        for key, val in drv.items():
            if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                drv[key] = None
    return frame


def _get_frames_sync(year: int, round_num: int, session_type: str) -> list[dict]:
    key = f"{year}_{round_num}_{session_type}"
    if key not in _replay_cache:
        frames = get_json(f"sessions/{year}/{round_num}/{session_type}/replay.json")
        if frames is None:
            frames = []
        for f in frames:
            _sanitize_frame(f)
        _replay_cache[key] = frames
    return _replay_cache[key]


async def _get_frames(year: int, round_num: int, session_type: str) -> list[dict]:
    return await asyncio.to_thread(_get_frames_sync, year, round_num, session_type)


@router.websocket("/ws/replay/{year}/{round_num}")
async def replay_websocket(
    websocket: WebSocket,
    year: int,
    round_num: int,
    type: str = Query("R"),
):
    await websocket.accept()

    try:
        async def send_status(msg: str):
            await websocket.send_json({"type": "status", "message": msg})

        await send_status("Loading session data...")

        # On-demand: process session if data doesn't exist yet
        available = await ensure_session_data_ws(year, round_num, type, send_status)

        if not available:
            await websocket.send_json({
                "type": "error",
                "message": "Failed to load session data. The session may not be available yet.",
            })
            await websocket.close()
            return

        # Clear cache entry in case we just processed new data
        cache_key = f"{year}_{round_num}_{type}"
        _replay_cache.pop(cache_key, None)

        frames = await _get_frames(year, round_num, type)

        if not frames:
            await websocket.send_json({"type": "error", "message": "No position data available"})
            await websocket.close()
            return

        # Extract qualifying phase start times for seek buttons
        quali_phases = []
        seen_phases = set()
        for f in frames:
            qp = f.get("quali_phase")
            if qp and qp["phase"] not in seen_phases:
                seen_phases.add(qp["phase"])
                quali_phases.append({"phase": qp["phase"], "timestamp": f["timestamp"]})

        await websocket.send_json({
            "type": "ready",
            "total_frames": len(frames),
            "total_time": frames[-1]["timestamp"] if frames else 0,
            "total_laps": frames[-1]["total_laps"] if frames else 0,
            "quali_phases": quali_phases if quali_phases else None,
        })

        # Send first frame immediately so cars are visible before play
        await websocket.send_json({"type": "frame", **frames[0]})

        # Playback state
        playing = False
        speed = 1.0
        frame_index = 0
        base_interval = 0.5

        async def send_seek_frame(target_time: float):
            nonlocal frame_index
            for i, f in enumerate(frames):
                if f["timestamp"] >= target_time:
                    frame_index = i
                    break
            if frame_index < len(frames):
                await websocket.send_json({"type": "frame", **frames[frame_index]})

        async def handle_command(cmd: str):
            nonlocal playing, speed, frame_index

            if cmd == "play":
                playing = True
            elif cmd == "pause":
                playing = False
            elif cmd.startswith("speed:"):
                try:
                    speed = float(cmd.split(":")[1])
                    speed = max(0.25, min(50.0, speed))
                except ValueError:
                    pass
            elif cmd.startswith("seek:"):
                try:
                    target_time = float(cmd.split(":")[1])
                    await send_seek_frame(target_time)
                except ValueError:
                    pass
            elif cmd.startswith("seeklap:"):
                try:
                    target_lap = int(cmd.split(":")[1])
                    for i, f in enumerate(frames):
                        if f["lap"] >= target_lap:
                            frame_index = i
                            break
                    if frame_index < len(frames):
                        await websocket.send_json({"type": "frame", **frames[frame_index]})
                except ValueError:
                    pass
            elif cmd == "reset":
                frame_index = 0
                playing = False
                await websocket.send_json({"type": "frame", **frames[0]})

        async def check_command(timeout: float) -> bool:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                await handle_command(msg.strip().lower())
                return True
            except asyncio.TimeoutError:
                return False

        while True:
            if playing and frame_index < len(frames):
                await websocket.send_json({"type": "frame", **frames[frame_index]})
                frame_index += 1

                if frame_index >= len(frames):
                    playing = False
                    await websocket.send_json({"type": "finished"})
                    continue

                remaining = base_interval / speed
                while remaining > 0 and playing:
                    chunk = min(remaining, 0.05)
                    await check_command(chunk)
                    remaining -= chunk
            else:
                await check_command(1.0)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {year}/{round_num}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
