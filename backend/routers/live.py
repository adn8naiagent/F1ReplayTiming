"""Live timing routes using OpenF1 API."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.openf1 import (
    get_live_session,
    get_session_drivers,
    get_positions,
    get_intervals,
    get_car_locations,
    get_laps,
    get_stints,
    get_pit_stops,
    get_weather,
    get_race_control,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/live", tags=["live"])

# Map OpenF1 compound codes to display names
COMPOUND_MAP = {
    "SOFT": "SOFT",
    "MEDIUM": "MEDIUM",
    "HARD": "HARD",
    "INTERMEDIATE": "INTERMEDIATE",
    "WET": "WET",
}


@router.get("/status")
async def live_status():
    """Check if there's a live or recent session available."""
    session = await asyncio.to_thread(get_live_session)
    if not session:
        return {"live": False, "session": None}

    session_status = session.get("session_type", "")
    session_name = session.get("session_name", "")
    date_start = session.get("date_start", "")
    date_end = session.get("date_end")

    # Determine if session is ongoing
    now = datetime.now(timezone.utc)
    is_active = False
    if date_start and not date_end:
        is_active = True
    elif date_start and date_end:
        try:
            end_dt = datetime.fromisoformat(date_end.replace("Z", "+00:00"))
            is_active = now <= end_dt
        except (ValueError, AttributeError):
            pass

    return {
        "live": True,
        "active": is_active,
        "session": {
            "session_key": session.get("session_key"),
            "session_name": session_name,
            "session_type": session_status,
            "circuit": session.get("circuit_short_name", ""),
            "country": session.get("country_name", ""),
            "event_name": f"{session.get('country_name', '')} Grand Prix",
            "date_start": date_start,
            "date_end": date_end,
            "year": session.get("year"),
        },
    }


def _build_driver_map(drivers: list[dict]) -> dict[int, dict]:
    """Build a map of driver_number -> driver info."""
    dmap = {}
    for d in drivers:
        num = d.get("driver_number")
        if num is not None:
            color = d.get("team_colour", "FFFFFF") or "FFFFFF"
            dmap[num] = {
                "abbr": d.get("name_acronym", ""),
                "full_name": d.get("full_name", ""),
                "team": d.get("team_name", ""),
                "color": f"#{color}",
                "number": str(num),
                "headshot_url": d.get("headshot_url", ""),
            }
    return dmap


def _build_live_frame(
    driver_map: dict[int, dict],
    positions: dict[int, int],
    intervals: dict[int, dict],
    locations: dict[int, dict],
    stints: dict[int, dict],
    pit_counts: dict[int, int],
    weather_latest: dict | None,
    status: str,
    lap: int,
    total_laps: int,
    track_norm: dict | None,
) -> dict:
    """Build a frame compatible with the replay format."""
    drivers_out = []

    for num, info in driver_map.items():
        pos = positions.get(num)
        ivl = intervals.get(num, {})
        loc = locations.get(num, {})
        stint = stints.get(num, {})

        # Normalize coordinates if we have track normalization params
        x = 0.0
        y = 0.0
        if loc and track_norm:
            raw_x = loc.get("x", 0)
            raw_y = loc.get("y", 0)
            scale = track_norm.get("scale", 1)
            x_min = track_norm.get("x_min", 0)
            y_min = track_norm.get("y_min", 0)
            if scale > 0:
                x = (raw_x - x_min) / scale
                y = (raw_y - y_min) / scale

        gap = ivl.get("gap_to_leader")
        interval = ivl.get("interval")

        # Format gap
        gap_str = None
        if gap is not None:
            if isinstance(gap, (int, float)):
                gap_str = f"+{gap:.3f}" if gap > 0 else "LAP 0"
            else:
                gap_str = str(gap)

        interval_str = None
        if interval is not None:
            if isinstance(interval, (int, float)):
                interval_str = f"+{interval:.3f}" if interval > 0 else "Leader"
            else:
                interval_str = str(interval)

        drivers_out.append({
            "abbr": info["abbr"],
            "x": x,
            "y": y,
            "color": info["color"],
            "team": info["team"],
            "position": pos,
            "grid_position": None,
            "compound": stint.get("compound"),
            "tyre_life": stint.get("tyre_age_at_start", 0),
            "pit_stops": pit_counts.get(num, 0),
            "in_pit": False,
            "tyre_history": [],
            "gap": gap_str,
            "interval": interval_str,
            "has_fastest_lap": False,
            "flag": None,
            "retired": False,
            "pit_start": False,
            "no_timing": pos is None,
            "relative_distance": 0,
            "speed": None,
            "throttle": None,
            "brake": False,
            "gear": None,
            "rpm": None,
            "drs": None,
            "pit_prediction": None,
        })

    # Sort by position
    drivers_out.sort(key=lambda d: d["position"] if d["position"] else 99)

    weather_out = None
    if weather_latest:
        weather_out = {
            "air_temp": weather_latest.get("air_temperature", 0),
            "track_temp": weather_latest.get("track_temperature", 0),
            "humidity": weather_latest.get("humidity", 0),
            "rainfall": weather_latest.get("rainfall", 0) > 0,
            "wind_speed": weather_latest.get("wind_speed", 0),
            "wind_direction": weather_latest.get("wind_direction", 0),
        }

    return {
        "timestamp": 0,
        "lap": lap,
        "total_laps": total_laps,
        "session_type": "R",
        "drivers": drivers_out,
        "status": status,
        "weather": weather_out,
    }


@router.websocket("/ws")
async def live_ws(websocket: WebSocket):
    """WebSocket endpoint for live timing updates."""
    await websocket.accept()
    logger.info("Live timing WebSocket connected")

    try:
        # Get current session
        session = await asyncio.to_thread(get_live_session)
        if not session:
            await websocket.send_json({"type": "error", "message": "No active session"})
            await websocket.close()
            return

        session_key = session["session_key"]
        total_laps = session.get("total_laps") or 0

        # Get drivers
        drivers_raw = await asyncio.to_thread(get_session_drivers, session_key)
        driver_map = _build_driver_map(drivers_raw)

        # Send session info
        await websocket.send_json({
            "type": "session_info",
            "data": {
                "year": session.get("year"),
                "round_number": session.get("meeting_key"),
                "event_name": f"{session.get('country_name', '')} Grand Prix",
                "circuit": session.get("circuit_short_name", ""),
                "country": session.get("country_name", ""),
                "session_type": session.get("session_type", "Race"),
                "drivers": [
                    {
                        "abbreviation": info["abbr"],
                        "driver_number": info["number"],
                        "full_name": info["full_name"],
                        "team_name": info["team"],
                        "team_color": info["color"],
                    }
                    for info in driver_map.values()
                ],
            },
        })

        # Main polling loop
        last_position_date = None
        last_interval_date = None
        track_norm = None

        # Build track normalization from first batch of location data
        initial_locs = await asyncio.to_thread(get_car_locations, session_key)
        if initial_locs:
            xs = [loc.get("x", 0) for loc in initial_locs if loc.get("x") is not None]
            ys = [loc.get("y", 0) for loc in initial_locs if loc.get("y") is not None]
            if xs and ys:
                x_min, x_max = min(xs), max(xs)
                y_min, y_max = min(ys), max(ys)
                scale = max(x_max - x_min, y_max - y_min)
                if scale == 0:
                    scale = 1
                track_norm = {"x_min": x_min, "y_min": y_min, "scale": scale}

        while True:
            try:
                # Fetch latest data in parallel
                positions_raw, intervals_raw, stints_raw, pits_raw, weather_raw, rc_raw = (
                    await asyncio.gather(
                        asyncio.to_thread(get_positions, session_key, last_position_date),
                        asyncio.to_thread(get_intervals, session_key, last_interval_date),
                        asyncio.to_thread(get_stints, session_key),
                        asyncio.to_thread(get_pit_stops, session_key),
                        asyncio.to_thread(get_weather, session_key),
                        asyncio.to_thread(get_race_control, session_key),
                    )
                )

                # Get latest car locations (separate, can be large)
                locations_raw = await asyncio.to_thread(get_car_locations, session_key, last_position_date)

                # Build latest position map (most recent per driver)
                positions: dict[int, int] = {}
                for p in positions_raw:
                    num = p.get("driver_number")
                    if num is not None:
                        positions[num] = p.get("position")
                    date = p.get("date")
                    if date:
                        last_position_date = date

                # Build latest intervals map
                intervals: dict[int, dict] = {}
                for iv in intervals_raw:
                    num = iv.get("driver_number")
                    if num is not None:
                        intervals[num] = {
                            "gap_to_leader": iv.get("gap_to_leader"),
                            "interval": iv.get("interval"),
                        }
                    date = iv.get("date")
                    if date:
                        last_interval_date = date

                # Build latest location map (most recent per driver)
                locations: dict[int, dict] = {}
                for loc in locations_raw:
                    num = loc.get("driver_number")
                    if num is not None:
                        locations[num] = {"x": loc.get("x", 0), "y": loc.get("y", 0)}

                # Build stints map (latest stint per driver)
                stints: dict[int, dict] = {}
                for s in stints_raw:
                    num = s.get("driver_number")
                    if num is not None:
                        stints[num] = {
                            "compound": s.get("compound"),
                            "tyre_age_at_start": s.get("tyre_age_at_start", 0),
                        }

                # Pit counts per driver
                pit_counts: dict[int, int] = {}
                for p in pits_raw:
                    num = p.get("driver_number")
                    if num is not None:
                        pit_counts[num] = pit_counts.get(num, 0) + 1

                # Latest weather
                weather_latest = weather_raw[-1] if weather_raw else None

                # Track status from race control
                status = "green"
                for rc in reversed(rc_raw):
                    flag = rc.get("flag")
                    if flag:
                        flag_lower = flag.lower()
                        if "red" in flag_lower:
                            status = "red"
                        elif "safety car" in flag_lower or flag == "SAFETY CAR":
                            status = "sc"
                        elif "virtual" in flag_lower or flag == "VIRTUAL SAFETY CAR":
                            status = "vsc"
                        elif "yellow" in flag_lower:
                            status = "yellow"
                        elif "green" in flag_lower or "clear" in flag_lower:
                            status = "green"
                        break

                # Current lap (from latest lap data)
                laps_raw = await asyncio.to_thread(get_laps, session_key)
                current_lap = 0
                if laps_raw:
                    for l in laps_raw:
                        ln = l.get("lap_number", 0)
                        if ln > current_lap:
                            current_lap = ln

                frame = _build_live_frame(
                    driver_map=driver_map,
                    positions=positions,
                    intervals=intervals,
                    locations=locations,
                    stints=stints,
                    pit_counts=pit_counts,
                    weather_latest=weather_latest,
                    status=status,
                    lap=current_lap,
                    total_laps=total_laps,
                    track_norm=track_norm,
                )

                await websocket.send_json({"type": "frame", "data": frame})

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.warning(f"Live WS polling error: {e}")

            # Poll every 5 seconds (free tier rate limit: 3 req/s, 30 req/min)
            await asyncio.sleep(5)

    except WebSocketDisconnect:
        logger.info("Live timing WebSocket disconnected")
    except Exception as e:
        logger.error(f"Live WS error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
