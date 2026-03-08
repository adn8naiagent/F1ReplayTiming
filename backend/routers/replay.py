import asyncio
import logging
import math
import re

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.storage import get_json
from services.process import ensure_session_data_ws

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

# In-memory cache for replay frames loaded from R2
_replay_cache: dict[str, list[dict]] = {}

# In-memory cache for pit loss data
_pit_loss_cache: dict | None = None


def _get_pit_loss_data() -> dict | None:
    global _pit_loss_cache
    if _pit_loss_cache is None:
        data = get_json("pit_loss.json")
        if data:
            _pit_loss_cache = data
    return _pit_loss_cache


def _parse_gap_seconds(gap: str | None) -> float | None:
    """Parse a gap string into seconds. Returns None for non-numeric gaps."""
    if not gap:
        return None
    if gap.startswith("LAP "):
        return None  # Leader — no gap
    m = re.match(r"^\+?([\d.]+)$", gap)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d+)\s*L(?:ap)?", gap)
    if m:
        return None  # Lapped — can't meaningfully predict
    return None


def _add_pit_predictions(frame: dict, pit_loss_green: float, pit_loss_sc: float, pit_loss_vsc: float):
    """Add pit_prediction field to each driver in the frame."""
    drivers = frame.get("drivers", [])
    status = frame.get("status", "green")
    lap = frame.get("lap", 0)

    # Don't show before lap 15
    if lap < 15:
        return

    # Select pit loss based on track status
    if status == "sc":
        pit_loss = pit_loss_sc
    elif status == "vsc":
        pit_loss = pit_loss_vsc
    else:
        pit_loss = pit_loss_green

    # Build list of (driver_abbr, gap_seconds) for drivers currently on track
    driver_gaps: list[tuple[str, float]] = []
    leader_gap = None
    for d in drivers:
        if d.get("retired") or d.get("in_pit"):
            continue
        gap = d.get("gap")
        if d.get("position") == 1:
            driver_gaps.append((d["abbr"], 0.0))
            leader_gap = 0.0
        else:
            gap_sec = _parse_gap_seconds(gap)
            if gap_sec is not None:
                driver_gaps.append((d["abbr"], gap_sec))

    if not driver_gaps:
        return

    # Sort by gap (ascending = leader first)
    driver_gaps.sort(key=lambda x: x[1])
    gap_values = [g for _, g in driver_gaps]

    for d in drivers:
        if d.get("retired") or d.get("in_pit"):
            d["pit_prediction"] = None
            continue

        current_gap = None
        if d.get("position") == 1:
            current_gap = 0.0
        else:
            current_gap = _parse_gap_seconds(d.get("gap"))

        if current_gap is None:
            d["pit_prediction"] = None
            continue

        projected_gap = current_gap + pit_loss

        # Find what position this projected gap would be
        predicted_pos = 1
        for g in gap_values:
            if projected_gap > g:
                predicted_pos += 1
            else:
                break

        # Don't count the driver themselves
        # If they'd be behind everyone, cap at field size
        predicted_pos = min(predicted_pos, len(driver_gaps))

        # Only show if they'd lose at least 1 position
        if predicted_pos > (d.get("position") or 0):
            d["pit_prediction"] = predicted_pos
        else:
            d["pit_prediction"] = None


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
    token: str = Query(""),
):
    from auth import is_auth_enabled, verify_token
    if is_auth_enabled() and not verify_token(token):
        await websocket.close(code=4401, reason="Unauthorized")
        return
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

        # Load pit loss data for races
        is_race = type in ("R", "S")
        pit_loss_green = 0.0
        pit_loss_sc = 0.0
        pit_loss_vsc = 0.0
        if is_race:
            pit_data = _get_pit_loss_data()
            if pit_data:
                # Try to find circuit-specific data by matching event name from session info
                info = get_json(f"sessions/{year}/{round_num}/{type}/info.json")
                event_name = info.get("event_name", "") if info else ""
                circuits = pit_data.get("circuits", {})
                circuit_entry = circuits.get(event_name)
                if circuit_entry:
                    pit_loss_green = circuit_entry.get("pit_loss_green", 0) or 0
                    pit_loss_sc = circuit_entry.get("pit_loss_sc", 0) or 0
                    pit_loss_vsc = circuit_entry.get("pit_loss_vsc", 0) or 0
                else:
                    # Fallback to global averages
                    ga = pit_data.get("global_averages", {})
                    pit_loss_green = ga.get("green", 22.0)
                    pit_loss_sc = ga.get("sc", 10.0)
                    pit_loss_vsc = ga.get("vsc", 14.5)
                logger.info(f"Pit loss for {event_name}: green={pit_loss_green}s, sc={pit_loss_sc}s, vsc={pit_loss_vsc}s")

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
            if is_race and pit_loss_green > 0:
                _add_pit_predictions(f, pit_loss_green, pit_loss_sc, pit_loss_vsc)
            return f

        # Send first frame immediately so cars are visible before play
        await websocket.send_json({"type": "frame", **prepare_frame(frames[0])})

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
                await websocket.send_json({"type": "frame", **prepare_frame(frames[frame_index])})

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
                        await websocket.send_json({"type": "frame", **prepare_frame(frames[frame_index])})
                except ValueError:
                    pass
            elif cmd == "reset":
                frame_index = 0
                playing = False
                await websocket.send_json({"type": "frame", **prepare_frame(frames[0])})

        async def check_command(timeout: float) -> bool:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                await handle_command(msg.strip().lower())
                return True
            except asyncio.TimeoutError:
                return False

        while True:
            if playing and frame_index < len(frames):
                await websocket.send_json({"type": "frame", **prepare_frame(frames[frame_index])})
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
