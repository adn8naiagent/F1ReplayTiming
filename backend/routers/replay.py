import asyncio
import logging
import math
import os
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.storage import get_json
from services.process import ensure_session_data_ws
from services.replay_chunks import add_pit_predictions, pit_loss_for
from app_config import is_valid_session

def _log_memory():
    """Log current process memory usage."""
    try:
        # Works on Linux (Docker) — reads from /proc
        with open(f"/proc/{os.getpid()}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    mem_mb = int(line.split()[1]) / 1024
                    break
            else:
                mem_mb = 0
    except FileNotFoundError:
        # macOS fallback
        import resource
        mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
    cache_sessions = len(_replay_cache)
    return f"process: {mem_mb:.0f}MB, cached sessions: {cache_sessions}"

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

# In-memory cache for replay frames loaded from R2
_replay_cache: dict[str, list[dict]] = {}
_replay_clients: dict[str, int] = {}  # key -> active WebSocket count
_eviction_tasks: dict[str, asyncio.Task] = {}  # key -> pending eviction task

CACHE_EVICTION_SECONDS = 300  # 5 minutes after last client disconnects

# Idle gap after which the server sends a keep-alive frame. Proxies and tunnels
# that only count data frames towards their idle timeout (commonly 60s or 300s)
# will close the socket otherwise — a paused replay sends nothing at all.
HEARTBEAT_SECONDS = 20

# Queued by the reader task when the client goes away, so the playback loop can
# raise WebSocketDisconnect from wherever it happens to be waiting.
_DISCONNECTED = object()

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
        logger.info(f"[memory] Cached {key} ({len(frames)} frames) — {_log_memory()}")
    return _replay_cache[key]


async def _get_frames(year: int, round_num: int, session_type: str) -> list[dict]:
    return await asyncio.to_thread(_get_frames_sync, year, round_num, session_type)


def _client_connect(key: str):
    """Register a WebSocket client for a cached session."""
    _replay_clients[key] = _replay_clients.get(key, 0) + 1
    # Cancel any pending eviction since a client is now connected
    task = _eviction_tasks.pop(key, None)
    if task:
        task.cancel()
        logger.info(f"[memory] Cancelled eviction for {key} — new client connected")


async def _client_disconnect(key: str):
    """Unregister a WebSocket client. Schedule eviction if no clients remain."""
    _replay_clients[key] = max(0, _replay_clients.get(key, 0) - 1)
    if _replay_clients[key] == 0:
        _replay_clients.pop(key, None)
        if key in _replay_cache:
            logger.info(f"[memory] No clients for {key}, scheduling eviction in {CACHE_EVICTION_SECONDS}s — {_log_memory()}")
            task = asyncio.create_task(_evict_after_delay(key))
            _eviction_tasks[key] = task


def evict_cached_session(year: int, round_num: int, session_type: str) -> None:
    """Drop a session's frames from memory immediately.

    Called when stored data is deleted; without it the frames stay resident
    until the normal eviction delay elapses.
    """
    key = f"{year}_{round_num}_{session_type}"
    task = _eviction_tasks.pop(key, None)
    if task:
        task.cancel()
    if _replay_cache.pop(key, None) is not None:
        logger.info(f"[memory] Evicted {key} after delete — {_log_memory()}")


async def _evict_after_delay(key: str):
    """Wait, then evict a cached session if no new clients have connected."""
    try:
        await asyncio.sleep(CACHE_EVICTION_SECONDS)
        if _replay_clients.get(key, 0) == 0 and key in _replay_cache:
            del _replay_cache[key]
            _eviction_tasks.pop(key, None)
            logger.info(f"[memory] Evicted {key} — {_log_memory()}")
    except asyncio.CancelledError:
        pass


@router.websocket("/ws/replay/{year}/{round_num}")
async def replay_websocket(
    websocket: WebSocket,
    year: int,
    round_num: int,
    type: str = Query("R"),
    token: str = Query(""),
):
    from auth import is_auth_enabled, verify_token
    if is_auth_enabled() and not verify_token(token):
        await websocket.close(code=4401, reason="Unauthorized")
        return
    if not is_valid_session(year, round_num, type):
        await websocket.close(code=4400, reason="Invalid session")
        return
    await websocket.accept()

    receiver_task: asyncio.Task | None = None

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

        await send_status("Preparing replay...")
        frames = await _get_frames(year, round_num, type)
        cache_key = f"{year}_{round_num}_{type}"
        _client_connect(cache_key)

        if not frames:
            await _client_disconnect(cache_key)
            await websocket.send_json({"type": "error", "message": "No position data available"})
            await websocket.close()
            return

        # Pit loss for races (zeros for other sessions, which disables predictions)
        pit_loss_green, pit_loss_sc, pit_loss_vsc = await asyncio.to_thread(
            pit_loss_for, year, round_num, type
        )

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

        # Helper to send a frame with pit predictions added
        def prepare_frame(f: dict) -> dict:
            if pit_loss_green > 0:
                add_pit_predictions(f, pit_loss_green, pit_loss_sc, pit_loss_vsc)
            return f

        last_send = time.monotonic()

        async def send_json(payload: dict) -> None:
            """Send, recording the time so the heartbeat only fires when idle."""
            nonlocal last_send
            await websocket.send_json(payload)
            last_send = time.monotonic()

        async def beat_if_idle() -> None:
            if time.monotonic() - last_send >= HEARTBEAT_SECONDS:
                await send_json({"type": "ping"})

        # Send first frame immediately so cars are visible before play
        await send_json({"type": "frame", **prepare_frame(frames[0])})

        # Playback state
        playing = False
        speed = 1.0
        frame_index = 0

        # Wall-clock anchor used to compute per-frame sleep durations.
        # Anchored at play/seek/speed-change so accumulated async overhead
        # never causes timing drift over long sessions.
        play_start_wall: float = 0.0
        play_start_session: float = 0.0

        def reset_anchor():
            nonlocal play_start_wall, play_start_session
            if frame_index < len(frames):
                play_start_wall = time.monotonic()
                play_start_session = frames[frame_index]["timestamp"]

        async def send_seek_frame(target_time: float):
            nonlocal frame_index
            for i, f in enumerate(frames):
                if f["timestamp"] >= target_time:
                    frame_index = i
                    break
            if frame_index < len(frames):
                await send_json({"type": "frame", **prepare_frame(frames[frame_index])})

        async def handle_command(cmd: str):
            nonlocal playing, speed, frame_index

            if cmd == "play":
                playing = True
                reset_anchor()
            elif cmd == "pause":
                playing = False
            elif cmd.startswith("speed:"):
                try:
                    speed = float(cmd.split(":")[1])
                    speed = max(0.25, min(50.0, speed))
                    reset_anchor()  # re-anchor at new speed
                except ValueError:
                    pass
            elif cmd.startswith("seek:"):
                try:
                    target_time = float(cmd.split(":")[1])
                    await send_seek_frame(target_time)
                    reset_anchor()
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
                        await send_json({"type": "frame", **prepare_frame(frames[frame_index])})
                    reset_anchor()
                except ValueError:
                    pass
            elif cmd == "reset":
                frame_index = 0
                playing = False
                await send_json({"type": "frame", **prepare_frame(frames[0])})
                reset_anchor()

        # One long-lived reader feeding a queue. The playback loop polls the
        # queue on a 50ms tick; cancelling a queue.get() is safe, whereas
        # cancelling websocket.receive_text() that often can drop commands.
        commands: asyncio.Queue = asyncio.Queue()

        async def receive_commands():
            try:
                while True:
                    await commands.put(await websocket.receive_text())
            except Exception:
                await commands.put(_DISCONNECTED)

        receiver_task = asyncio.create_task(receive_commands())

        async def check_command(timeout: float) -> bool:
            try:
                msg = await asyncio.wait_for(commands.get(), timeout=timeout)
            except asyncio.TimeoutError:
                return False
            if msg is _DISCONNECTED:
                raise WebSocketDisconnect(1006)
            await handle_command(msg.strip().lower())
            return True

        while True:
            if playing and frame_index < len(frames):
                await send_json({"type": "frame", **prepare_frame(frames[frame_index])})
                frame_index += 1

                if frame_index >= len(frames):
                    playing = False
                    await send_json({"type": "finished"})
                    continue

                # Sleep until the next frame is due per wall clock.
                # sleep_remaining is recomputed from the actual clock each iteration
                # so any processing overhead is automatically absorbed.
                next_session_time = frames[frame_index]["timestamp"]
                target_wall = play_start_wall + (next_session_time - play_start_session) / speed
                sleep_remaining = target_wall - time.monotonic()

                while sleep_remaining > 0 and playing:
                    chunk = min(sleep_remaining, 0.05)
                    await check_command(chunk)
                    # Covers long gaps between frames: red flags, and slow speeds.
                    await beat_if_idle()
                    sleep_remaining = target_wall - time.monotonic()
            else:
                # Paused, or waiting to start — nothing else is sent here.
                await check_command(1.0)
                await beat_if_idle()

    except WebSocketDisconnect:
        cache_key = f"{year}_{round_num}_{type}"
        await _client_disconnect(cache_key)
        logger.info(f"[memory] WebSocket disconnected: {year}/{round_num}/{type} — {_log_memory()}")
    except Exception as e:
        cache_key = f"{year}_{round_num}_{type}"
        await _client_disconnect(cache_key)
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
    finally:
        if receiver_task is not None:
            receiver_task.cancel()
