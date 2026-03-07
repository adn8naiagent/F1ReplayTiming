import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.f1_data import get_driver_positions_by_time

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

# Cache computed replay frames
_replay_cache: dict[str, list[dict]] = {}


async def _get_frames(year: int, round_num: int, session_type: str) -> list[dict]:
    key = f"{year}_{round_num}_{session_type}"
    if key not in _replay_cache:
        frames = await get_driver_positions_by_time(year, round_num, session_type)
        _replay_cache[key] = frames
    return _replay_cache[key]


@router.websocket("/ws/replay/{year}/{round_num}")
async def replay_websocket(
    websocket: WebSocket,
    year: int,
    round_num: int,
    type: str = Query("R"),
):
    await websocket.accept()

    try:
        # Send loading status
        await websocket.send_json({"type": "status", "message": "Loading session data..."})

        frames = await _get_frames(year, round_num, type)

        if not frames:
            await websocket.send_json({"type": "error", "message": "No position data available"})
            await websocket.close()
            return

        await websocket.send_json({
            "type": "ready",
            "total_frames": len(frames),
            "total_time": frames[-1]["timestamp"] if frames else 0,
            "total_laps": frames[-1]["total_laps"] if frames else 0,
        })

        # Send first frame immediately so cars are visible before play
        await websocket.send_json({"type": "frame", **frames[0]})

        # Playback state
        playing = False
        speed = 1.0
        frame_index = 0
        base_interval = 0.5  # matches the 0.5s sampling rate

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
            """Check for and handle one command. Returns True if received."""
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                await handle_command(msg.strip().lower())
                return True
            except asyncio.TimeoutError:
                return False

        while True:
            if playing and frame_index < len(frames):
                # Send current frame
                await websocket.send_json({"type": "frame", **frames[frame_index]})
                frame_index += 1

                if frame_index >= len(frames):
                    playing = False
                    await websocket.send_json({"type": "finished"})
                    continue

                # Wait for the interval, checking for commands periodically
                remaining = base_interval / speed
                while remaining > 0 and playing:
                    chunk = min(remaining, 0.05)
                    await check_command(chunk)
                    remaining -= chunk
            else:
                # Not playing — block waiting for commands
                await check_command(1.0)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {year}/{round_num}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
