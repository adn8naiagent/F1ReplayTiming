from __future__ import annotations

import asyncio
import os
import logging
import threading
from datetime import datetime, timezone
from functools import lru_cache

import fastf1
from fastf1 import api as f1api
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", os.path.join(os.path.dirname(__file__), "..", ".fastf1-cache"))

# Enable cache on import
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)
except OSError:
    # Fallback to temp dir if configured path is not writable
    import tempfile
    CACHE_DIR = os.path.join(tempfile.gettempdir(), "fastf1-cache")
    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)

# In-memory cache for loaded sessions (with lock to prevent concurrent duplicate loads)
_session_cache: dict[str, fastf1.core.Session] = {}
_session_lock = threading.Lock()


def _cache_key(year: int, round_num: int, session_type: str) -> str:
    return f"{year}_{round_num}_{session_type}"


# Cache for session availability checks: key -> bool
_availability_cache: dict[str, bool] = {}


def _check_session_has_data(year: int, round_num: int, session_type: str) -> bool:
    """Check if full data (laps + telemetry with position coords) is available."""
    key = f"avail_{year}_{round_num}_{session_type}"
    if key in _availability_cache:
        return _availability_cache[key]

    try:
        session = fastf1.get_session(year, round_num, session_type)
        session.load(laps=True, telemetry=True, weather=False)

        if len(session.laps) == 0:
            _availability_cache[key] = False
            return False

        # Check that telemetry with X/Y position data is actually available
        fastest = session.laps.pick_fastest()
        tel = fastest.get_telemetry()
        has_full_data = tel is not None and "X" in tel.columns and len(tel) > 0

        # Only cache positive results  - negative might change as data becomes available
        if has_full_data:
            _availability_cache[key] = True
        return has_full_data
    except Exception:
        return False


SESSION_NAME_TO_TYPE: dict[str, str] = {
    "Race": "R",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
}


# Cache for raw schedule data: year -> list of event dicts (static, fetched once)
_schedule_cache: dict[int, list[dict]] = {}
_schedule_lock = threading.Lock()


def _fetch_schedule_sync(year: int) -> list[dict]:
    """Fetch and cache the raw schedule from FastF1. Only called once per year."""
    if year in _schedule_cache:
        return _schedule_cache[year]

    with _schedule_lock:
        if year in _schedule_cache:
            return _schedule_cache[year]

        logger.info(f"Fetching schedule for {year} from FastF1...")
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        events = []

        for _, row in schedule.iterrows():
            if row["RoundNumber"] == 0:
                continue

            sessions_raw = []
            for i in range(1, 6):
                name = row.get(f"Session{i}", "")
                if not (name and isinstance(name, str) and name.strip()):
                    continue
                date_utc = row.get(f"Session{i}DateUtc")
                sessions_raw.append({
                    "name": name,
                    "date_utc": date_utc.isoformat() + "Z" if pd.notna(date_utc) else None,
                    "_ts": date_utc.to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(date_utc) else None,
                })

            event_date = row.get("EventDate")
            event_dt = pd.Timestamp(event_date).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(event_date) else None

            events.append({
                "round_number": int(row["RoundNumber"]),
                "country": str(row.get("Country", "")),
                "event_name": str(row.get("EventName", "")),
                "location": str(row.get("Location", "")),
                "event_date": str(row.get("EventDate", ""))[:10],
                "sessions_raw": sessions_raw,
                "_event_dt": event_dt,
            })

        _schedule_cache[year] = events
        logger.info(f"Schedule for {year} cached ({len(events)} events).")
        return events


def _get_season_events_sync(year: int) -> list[dict]:
    """Build events list with availability status. Schedule is cached; only status computation is dynamic."""
    from datetime import timedelta
    raw_events = _fetch_schedule_sync(year)
    now = datetime.now(timezone.utc)
    events = []

    for raw in raw_events:
        sessions = []
        has_any_available = False
        for s in raw["sessions_raw"]:
            ts = s["_ts"]
            available = ts is not None and now > ts + timedelta(hours=2)
            if available:
                has_any_available = True
            sessions.append({
                "name": s["name"],
                "date_utc": s["date_utc"],
                "available": available,
            })

        event_dt = raw["_event_dt"]
        is_future_event = event_dt is None or event_dt > now

        if has_any_available:
            status = "available"
        elif is_future_event:
            status = "future"
        else:
            status = "available"

        events.append({
            "round_number": raw["round_number"],
            "country": raw["country"],
            "event_name": raw["event_name"],
            "location": raw["location"],
            "event_date": raw["event_date"],
            "sessions": sessions,
            "status": status,
        })

    # Mark the latest available event
    for evt in reversed(events):
        if evt["status"] == "available":
            evt["status"] = "latest"
            break

    return events


async def get_season_events(year: int) -> list[dict]:
    """Return events for a season (non-blocking)."""
    return await asyncio.to_thread(_get_season_events_sync, year)


def _load_session(year: int, round_num: int, session_type: str) -> fastf1.core.Session:
    key = _cache_key(year, round_num, session_type)
    if key in _session_cache:
        return _session_cache[key]

    with _session_lock:
        # Double-check after acquiring lock
        if key in _session_cache:
            return _session_cache[key]

        logger.info(f"Loading session {year}/{round_num}/{session_type} from FastF1...")
        session = fastf1.get_session(year, round_num, session_type)
        session.load(
            telemetry=True,
            laps=True,
            weather=True,
            messages=True,
        )

        # Only cache if we actually got meaningful data
        if len(session.laps) > 0:
            _session_cache[key] = session

        logger.info(f"Session {year}/{round_num}/{session_type} loaded.")
        return session


def _get_session_info_sync(year: int, round_num: int, session_type: str = "R") -> dict:
    session = _load_session(year, round_num, session_type)
    drivers = []
    for _, row in session.results.iterrows():
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        drivers.append({
            "abbreviation": str(row.get("Abbreviation", "")),
            "driver_number": str(row.get("DriverNumber", "")),
            "full_name": str(row.get("FullName", "")),
            "team_name": str(row.get("TeamName", "")),
            "team_color": f"#{color}",
        })
    return {
        "year": year,
        "round_number": round_num,
        "event_name": str(session.event["EventName"]),
        "circuit": str(session.event.get("Location", "")),
        "country": str(session.event.get("Country", "")),
        "session_type": session_type,
        "drivers": drivers,
    }


async def get_session_info(year: int, round_num: int, session_type: str = "R") -> dict:
    return await asyncio.to_thread(_get_session_info_sync, year, round_num, session_type)


# The track outline is drawn from one lap's position trace. The F1 position feed
# sometimes repeats a car's previous coordinate instead of sending a new one, so a
# lap can have a full complement of samples but only a handful of distinct points,
# and it renders as a coarse polygon rather than the circuit. Below this many
# distinct points, look for a better lap elsewhere in the weekend.
MIN_OUTLINE_POSITION_POINTS = 150

# Preference order when borrowing an outline from another session of the same
# weekend. Track geometry does not change between sessions, so any of them will do.
_OUTLINE_SESSION_PREFERENCE = ("Q", "FP3", "FP2", "FP1", "SQ", "S", "R")


def _distinct_position_points(lap) -> int:
    """Count the position samples on `lap` where the car actually moved.

    Repeated coordinates contribute no shape to the outline, so they don't count
    towards whether a lap is dense enough to draw.
    """
    try:
        pos = lap.get_pos_data()
    except Exception:
        return 0
    if pos is None or len(pos) < 2:
        return 0
    x = pos["X"].values.astype(float)
    y = pos["Y"].values.astype(float)
    repeats = int(((np.diff(x) == 0) & (np.diff(y) == 0)).sum())
    return len(x) - repeats


@lru_cache(maxsize=64)
def _outline_source_session(year: int, round_num: int, session_type: str) -> str | None:
    """Session type whose fastest lap should draw the track for this session.

    Normally the session's own fastest lap. When a session's position feed was
    degraded every lap in it traces the same coarse polygon (the 2026 Hungarian
    race gives 26 distinct points against ~300 in qualifying), so fall back to
    another session from the same weekend.
    """
    candidates = [session_type] + [s for s in _OUTLINE_SESSION_PREFERENCE if s != session_type]
    own_points = None
    best_type, best_points = None, -1

    for st in candidates:
        try:
            lap = _load_session(year, round_num, st).laps.pick_fastest()
        except Exception:
            continue
        if lap is None:
            continue

        points = _distinct_position_points(lap)
        if st == session_type:
            own_points = points
        if points > best_points:
            best_type, best_points = st, points

        if points >= MIN_OUTLINE_POSITION_POINTS:
            if st != session_type:
                logger.warning(
                    f"[{year} R{round_num} {session_type}] outline lap has only {own_points} "
                    f"distinct position points, drawing the track from {st} instead ({points} points)"
                )
            return st

    if best_type is not None:
        logger.warning(
            f"[{year} R{round_num} {session_type}] no session this weekend has a clean position "
            f"trace, falling back to {best_type} with {best_points} distinct points"
        )
    return best_type


def _pick_outline_lap(year: int, round_num: int, session_type: str):
    """The lap that draws the track outline and normalises replay coordinates.

    Both uses must share one lap, otherwise the driver dots are scaled against a
    different bounding box than the track they're drawn on.
    """
    src = _outline_source_session(year, round_num, session_type)
    if src is None:
        return None
    try:
        return _load_session(year, round_num, src).laps.pick_fastest()
    except Exception:
        return None


def _get_track_data_sync(year: int, round_num: int, session_type: str = "R") -> dict:
    session = _load_session(year, round_num, session_type)

    rotation = 0.0
    corners_raw = None
    marshal_sectors_raw = None
    try:
        circuit_info = session.get_circuit_info()
        rotation = float(circuit_info.rotation) if hasattr(circuit_info, "rotation") else 0.0
        if hasattr(circuit_info, "corners") and circuit_info.corners is not None and len(circuit_info.corners) > 0:
            corners_raw = circuit_info.corners
        if hasattr(circuit_info, "marshal_sectors") and circuit_info.marshal_sectors is not None and len(circuit_info.marshal_sectors) > 0:
            marshal_sectors_raw = circuit_info.marshal_sectors
    except Exception:
        pass

    # Get track coordinates from the outline reference lap
    fastest_lap = _pick_outline_lap(year, round_num, session_type)
    telemetry = fastest_lap.get_telemetry() if fastest_lap is not None else None

    if telemetry is None or "X" not in telemetry.columns or len(telemetry) == 0:
        raise ValueError("Telemetry data not available for this session")

    x = telemetry["X"].values
    y = telemetry["Y"].values

    # Elevation (Z is in 1/10 m). Store each point's height in metres above the
    # track's lowest point, plus the total range, so the frontend can colour the
    # line on a fixed absolute scale (flat tracks stay flat-looking).
    z_rel_m = None
    elevation = None
    if "Z" in telemetry.columns:
        z = telemetry["Z"].values.astype(float)
        if len(z) > 0 and not np.isnan(z).all():
            z_min = float(np.nanmin(z))
            z_max = float(np.nanmax(z))
            z_rel = (np.nan_to_num(z, nan=z_min) - z_min) / 10.0
            z_rel_m = [round(float(v), 2) for v in z_rel]
            elevation = {"range_m": round((z_max - z_min) / 10.0, 1)}

    # Normalize to 0-1 range for frontend flexibility
    x_min, x_max = float(x.min()), float(x.max())
    y_min, y_max = float(y.min()), float(y.max())
    scale = max(x_max - x_min, y_max - y_min)
    if scale == 0:
        scale = 1

    x_norm = ((x - x_min) / scale).tolist()
    y_norm = ((y - y_min) / scale).tolist()

    # Compute sector boundaries from fastest lap sector session times
    sector_boundaries = None
    try:
        s1_session_time = fastest_lap["Sector1SessionTime"]
        s2_session_time = fastest_lap["Sector2SessionTime"]
        if pd.notna(s1_session_time) and pd.notna(s2_session_time):
            session_times = telemetry["SessionTime"]
            s1_idx = int((session_times - s1_session_time).abs().idxmin())
            s2_idx = int((session_times - s2_session_time).abs().idxmin())
            # Convert DataFrame index to positional index
            s1_pos = telemetry.index.get_loc(s1_idx)
            s2_pos = telemetry.index.get_loc(s2_idx)
            sector_boundaries = {
                "s1_end": int(s1_pos),
                "s2_end": int(s2_pos),
                "total": len(telemetry),
            }
            logger.info(f"Sector boundaries: S1 ends at point {s1_pos}/{len(telemetry)}, S2 ends at {s2_pos}/{len(telemetry)}")
    except Exception as e:
        logger.warning(f"Could not compute sector boundaries: {e}")

    # Normalize corner positions using the same scale as track points
    corners = None
    if corners_raw is not None:
        try:
            corners = []
            for _, c in corners_raw.iterrows():
                corners.append({
                    "x": float((c["X"] - x_min) / scale),
                    "y": float((c["Y"] - y_min) / scale),
                    "number": int(c["Number"]),
                    "letter": str(c.get("Letter", "")),
                    "angle": float(c.get("Angle", 0)),
                })
            logger.info(f"Extracted {len(corners)} corner positions")
        except Exception as e:
            logger.warning(f"Could not extract corner data: {e}")
            corners = None

    # Normalize marshal sector positions
    marshal_sectors = None
    if marshal_sectors_raw is not None:
        try:
            marshal_sectors = []
            for _, ms in marshal_sectors_raw.iterrows():
                marshal_sectors.append({
                    "x": float((ms["X"] - x_min) / scale),
                    "y": float((ms["Y"] - y_min) / scale),
                    "number": int(ms["Number"]),
                })
            logger.info(f"Extracted {len(marshal_sectors)} marshal sector positions")
        except Exception as e:
            logger.warning(f"Could not extract marshal sector data: {e}")
            marshal_sectors = None

    if z_rel_m is not None:
        track_points = [{"x": px, "y": py, "z": pz} for px, py, pz in zip(x_norm, y_norm, z_rel_m)]
    else:
        track_points = [{"x": px, "y": py} for px, py in zip(x_norm, y_norm)]

    return {
        "track_points": track_points,
        "rotation": rotation,
        "circuit_name": str(session.event.get("Location", "")),
        # Raw normalization params so driver positions use the same reference
        "norm": {"x_min": x_min, "y_min": y_min, "scale": scale},
        "sector_boundaries": sector_boundaries,
        "corners": corners,
        "marshal_sectors": marshal_sectors,
        "elevation": elevation,
    }


async def get_track_data(year: int, round_num: int, session_type: str = "R") -> dict:
    return await asyncio.to_thread(_get_track_data_sync, year, round_num, session_type)


def _get_lap_data_sync(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    session = _load_session(year, round_num, session_type)
    laps = session.laps

    # Compute the replay start offset — must match how replay frames are generated.
    # Replay uses min(Date) from driver telemetry (get_telemetry()), NOT pos_data.
    # FastF1 lap Time is relative to t0_date, so: replay_ts = Time - (min_tel_date - t0_date)
    replay_offset_secs = 0.0
    try:
        all_dates = []
        drivers_list = laps["Driver"].unique().tolist()
        for drv in drivers_list:
            drv_laps = laps.pick_drivers(drv)
            try:
                tel = drv_laps.get_telemetry()
                if tel is not None and "Date" in tel.columns and len(tel) > 0:
                    all_dates.extend(tel["Date"].dropna().tolist())
            except Exception:
                continue
        if all_dates and hasattr(session, "t0_date") and session.t0_date is not None:
            min_date = min(all_dates)
            replay_offset_secs = (min_date - session.t0_date).total_seconds()
    except Exception:
        replay_offset_secs = 0.0

    result = []
    for _, lap in laps.iterrows():
        def fmt_time(td):
            if pd.isna(td):
                return None
            total = td.total_seconds()
            mins = int(total // 60)
            secs = total % 60
            if mins > 0:
                return f"{mins}:{secs:06.3f}"
            return f"{secs:.3f}"

        # Lap completion time relative to replay start (not session start)
        lap_end_time = None
        if pd.notna(lap.get("Time")):
            lap_end_time = round(lap["Time"].total_seconds() - replay_offset_secs, 3)

        result.append({
            "driver": str(lap.get("Driver", "")),
            "lap_number": int(lap.get("LapNumber", 0)),
            "position": int(lap["Position"]) if pd.notna(lap.get("Position")) else None,
            "lap_time": fmt_time(lap.get("LapTime")),
            "time": lap_end_time,
            "sector1": fmt_time(lap.get("Sector1Time")),
            "sector2": fmt_time(lap.get("Sector2Time")),
            "sector3": fmt_time(lap.get("Sector3Time")),
            "compound": str(lap.get("Compound", "")) if pd.notna(lap.get("Compound")) else None,
            "tyre_life": int(lap["TyreLife"]) if pd.notna(lap.get("TyreLife")) else None,
            "pit_in": bool(lap.get("PitInTime") is not pd.NaT and pd.notna(lap.get("PitInTime"))),
            "pit_out": bool(lap.get("PitOutTime") is not pd.NaT and pd.notna(lap.get("PitOutTime"))),
        })
    return result


async def get_lap_data(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    return await asyncio.to_thread(_get_lap_data_sync, year, round_num, session_type)


def _get_driver_telemetry_sync(
    year: int, round_num: int, session_type: str, driver: str, lap_number: int
) -> dict | None:
    """Return telemetry trace for a single driver on a single lap."""
    session = _load_session(year, round_num, session_type)
    laps_df = session.laps

    drv_laps = laps_df.pick_drivers(driver)
    lap_row = drv_laps[drv_laps["LapNumber"] == lap_number]
    if len(lap_row) == 0:
        return None

    try:
        tel = lap_row.get_telemetry()
    except Exception:
        return None

    if tel is None or len(tel) == 0:
        return None

    return _format_lap_telemetry(tel, driver, lap_number)


def _format_lap_telemetry(tel: "pd.DataFrame", driver: str, lap_number: int) -> dict:
    # Build arrays  - use Distance as x-axis (relative to lap)
    has_distance = "Distance" in tel.columns
    has_drs = "DRS" in tel.columns

    # Downsample if too many points (target ~500 points for smooth charts)
    step = max(1, len(tel) // 500)
    tel_sampled = tel.iloc[::step]

    result = {
        "driver": driver,
        "lap": lap_number,
        "distance": tel_sampled["Distance"].tolist() if has_distance else list(range(len(tel_sampled))),
        "speed": tel_sampled["Speed"].astype(float).tolist(),
        "throttle": tel_sampled["Throttle"].astype(float).tolist(),
        "brake": [int(b) * 100 for b in tel_sampled["Brake"].tolist()],
        "gear": tel_sampled["nGear"].astype(int).tolist(),
        "rpm": tel_sampled["RPM"].astype(float).tolist(),
    }
    if has_drs:
        result["drs"] = tel_sampled["DRS"].astype(int).tolist()

    # Include relative distance for position marker mapping
    if "RelativeDistance" in tel_sampled.columns:
        result["relative_distance"] = tel_sampled["RelativeDistance"].astype(float).tolist()
    return result


def _get_driver_telemetry_bulk_sync(
    year: int, round_num: int, session_type: str, driver: str, lap_numbers: list[int]
) -> dict[str, dict]:
    """Return telemetry for multiple laps of a driver in a single FastF1 call."""
    session = _load_session(year, round_num, session_type)
    laps_df = session.laps

    drv_laps = laps_df.pick_drivers(driver)
    drv_laps = drv_laps[drv_laps["LapNumber"].isin(lap_numbers)]
    if len(drv_laps) == 0:
        return {}

    try:
        tel_all = drv_laps.get_telemetry()
    except Exception:
        return {}

    if tel_all is None or len(tel_all) == 0:
        return {}

    result = {}
    for _, lap_row in drv_laps.iterrows():
        lap_num = int(lap_row["LapNumber"])
        if lap_num not in lap_numbers:
            continue
        tel_lap = tel_all.slice_by_lap(lap_row, interpolate_edges=True)
        result[str(lap_num)] = _format_lap_telemetry(tel_lap, driver, lap_num)

    return result


async def get_driver_telemetry(
    year: int, round_num: int, session_type: str, driver: str, lap_number: int
) -> dict | None:
    return await asyncio.to_thread(
        _get_driver_telemetry_sync, year, round_num, session_type, driver, lap_number
    )


def _get_race_results_sync(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    session = _load_session(year, round_num, session_type)
    results = session.results

    def fmt_time(td):
        if pd.isna(td):
            return None
        total = td.total_seconds()
        mins = int(total // 60)
        secs = total % 60
        if mins > 0:
            return f"{mins}:{secs:06.3f}"
        return f"{secs:.3f}"

    output = []
    for _, row in results.iterrows():
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        pos = row.get("Position")
        grid = row.get("GridPosition")
        output.append({
            "position": int(pos) if pd.notna(pos) else None,
            "driver": str(row.get("FullName", "")),
            "abbreviation": str(row.get("Abbreviation", "")),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{color}",
            "grid_position": int(grid) if pd.notna(grid) else None,
            "status": str(row.get("Status", "")),
            "points": float(row.get("Points", 0)),
            "fastest_lap": None,
            "gap_to_leader": None,
        })
    output.sort(key=lambda d: d["position"] if d["position"] is not None else 999)
    return output


async def get_race_results(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    return await asyncio.to_thread(_get_race_results_sync, year, round_num, session_type)


def _get_driver_positions_by_time_sync(
    year: int, round_num: int, session_type: str = "R"
) -> list[dict]:
    """Build frame-by-frame position data for the replay engine."""
    session = _load_session(year, round_num, session_type)
    laps = session.laps
    total_laps = int(laps["LapNumber"].max()) if len(laps) > 0 else 0
    is_race = session_type in ("R", "S")  # Race or Sprint

    # Get position data (x, y coords over time) for each driver
    frames = []
    drivers_list = laps["Driver"].unique().tolist()

    # Collect all car position data (merged telemetry has cumulative Distance)
    driver_pos_data = {}
    for drv in drivers_list:
        drv_laps = laps.pick_drivers(drv)
        try:
            tel = drv_laps.get_telemetry()
            if tel is not None and len(tel) > 0:
                driver_pos_data[drv] = tel
        except Exception:
            continue

    if not driver_pos_data:
        return []

    # Find common time range
    all_dates = []
    for drv, tel in driver_pos_data.items():
        if "Date" in tel.columns and len(tel) > 0:
            all_dates.extend(tel["Date"].dropna().tolist())

    if not all_dates:
        return []

    min_date = min(all_dates)
    max_date = max(all_dates)
    total_seconds = (max_date - min_date).total_seconds()

    # Sample every 0.5 seconds for smooth replay
    sample_interval = 0.5
    num_samples = int(total_seconds / sample_interval)

    # Use the same normalization as the track outline (same reference lap)
    # so driver dots align exactly with the drawn track
    fastest_lap = _pick_outline_lap(year, round_num, session_type)
    fastest_tel = fastest_lap.get_telemetry() if fastest_lap is not None else None
    if fastest_tel is not None and "X" in fastest_tel.columns and len(fastest_tel) > 0:
        x_min = float(fastest_tel["X"].min())
        x_max = float(fastest_tel["X"].max())
        y_min = float(fastest_tel["Y"].min())
        y_max = float(fastest_tel["Y"].max())
    else:
        # Fallback to all drivers if fastest lap unavailable
        x_all = []
        y_all = []
        for tel in driver_pos_data.values():
            x_all.extend(tel["X"].values.tolist())
            y_all.extend(tel["Y"].values.tolist())
        x_min, x_max = min(x_all), max(x_all)
        y_min, y_max = min(y_all), max(y_all)

    scale = max(x_max - x_min, y_max - y_min)
    if scale == 0:
        scale = 1

    # Get session results for team colors, team names, number->abbr mapping, and retirement status
    colors = {}
    teams = {}
    number_to_abbr = {}
    retired_drivers = set()
    finished_drivers: dict[str, int] = {}  # abbr -> final position
    finished_driver_laps: dict[str, int] = {}  # abbr -> total laps completed
    grid_positions = {}
    for _, row in session.results.iterrows():
        abbr = str(row.get("Abbreviation", ""))
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        colors[abbr] = f"#{color}"
        teams[abbr] = str(row.get("TeamName", ""))
        num = str(row.get("DriverNumber", ""))
        if num:
            number_to_abbr[num] = abbr
        status = str(row.get("Status", "")).strip()
        is_classified = status in ("Finished", "Lapped") or status.startswith("+")
        if status and not is_classified and status != "":
            retired_drivers.add(abbr)
        if is_classified:
            final_pos = row.get("Position")
            if pd.notna(final_pos):
                finished_drivers[abbr] = int(final_pos)
            result_laps = row.get("Laps")
            if pd.notna(result_laps):
                finished_driver_laps[abbr] = int(result_laps)
        grid = row.get("GridPosition")
        if pd.notna(grid):
            grid_val = int(grid)
            if grid_val > 0:
                grid_positions[abbr] = grid_val

    # If grid positions are missing (e.g. F1 API returns -1 for all),
    # fall back to qualifying results position as grid order
    if is_race and not grid_positions:
        quali_type = "SQ" if session_type == "S" else "Q"
        try:
            quali_session = _load_session(year, round_num, quali_type)
            for _, row in quali_session.results.iterrows():
                q_abbr = str(row.get("Abbreviation", ""))
                q_pos = row.get("Position")
                if q_abbr and pd.notna(q_pos) and int(q_pos) > 0:
                    grid_positions[q_abbr] = int(q_pos)
            if grid_positions:
                logger.info(f"Grid positions unavailable, using {quali_type} results as fallback ({len(grid_positions)} drivers)")
        except Exception as e:
            logger.warning(f"Could not load {quali_type} session for grid fallback: {e}")

    # Pre-compute fastest lap holder by lap number
    fastest_by_lap = {}
    best_lap_time = None
    best_lap_driver = None
    for lap_num in sorted(laps["LapNumber"].unique()):
        lap_rows = laps[laps["LapNumber"] == lap_num]
        for _, lr in lap_rows.iterrows():
            lt = lr.get("LapTime")
            if pd.notna(lt):
                secs = lt.total_seconds()
                if best_lap_time is None or secs < best_lap_time:
                    best_lap_time = secs
                    best_lap_driver = str(lr["Driver"])
        fastest_by_lap[int(lap_num)] = best_lap_driver

    # Pre-compute race control flag events (investigation / penalty)
    # Each entry: (time_offset_seconds, abbr, flag_type)
    flag_events = []

    # Build abbr lookup from 3-letter codes mentioned in message text
    abbr_set = set(number_to_abbr.values())

    def _extract_drivers_from_msg(msg_text: str, racing_num: str | None) -> list[str]:
        """Extract driver abbreviations from RacingNumber field or message text."""
        drivers = []
        # Try RacingNumber field first
        if racing_num and racing_num not in ("", "nan", "None", "0"):
            abbr = number_to_abbr.get(racing_num) or number_to_abbr.get(racing_num.lstrip("0"))
            if abbr:
                drivers.append(abbr)
        # Fallback: parse "CAR 23 (ALB)" or "CARS 6 (HAD) AND 87 (BEA)" from text
        if not drivers:
            import re as _re
            for m in _re.finditer(r'CAR\s+\d+\s*\(([A-Z]{3})\)', msg_text.upper()):
                abbr = m.group(1)
                if abbr in abbr_set:
                    drivers.append(abbr)
        return drivers

    try:
        rcm = session.race_control_messages
        logger.info(f"Race control messages: {len(rcm) if rcm is not None else 'None'} entries")
        if rcm is not None and len(rcm) > 0:
            logger.info(f"RCM columns: {list(rcm.columns)}")
            for _, msg_row in rcm.iterrows():
                msg_time = msg_row.get("Time")
                if pd.isna(msg_time):
                    continue
                # Time may be Timestamp or Timedelta - handle both
                if hasattr(msg_time, 'total_seconds'):
                    time_sec = msg_time.total_seconds()
                else:
                    try:
                        time_sec = (msg_time - min_date).total_seconds()
                    except Exception:
                        continue
                message = str(msg_row.get("Message", "")).upper()
                category = str(msg_row.get("Category", "")).upper()
                racing_number = str(msg_row.get("RacingNumber", ""))

                drivers_in_msg = _extract_drivers_from_msg(message, racing_number)
                if not drivers_in_msg:
                    continue

                # Determine flag type
                if "NO FURTHER ACTION" in message or "NO FURTHER INVESTIGATION" in message or "CLEARED" in message:
                    flag_type = "clear"
                elif "PENALTY SERVED" in message:
                    flag_type = "clear"
                elif "PENALTY" in message or "PENALTY" in category:
                    flag_type = "penalty"
                elif "INVESTIGATION" in message or "INVESTIGATION" in category or "NOTED" in message:
                    flag_type = "investigation"
                else:
                    continue

                for abbr in drivers_in_msg:
                    logger.info(f"RCM flag: {abbr} | {flag_type} | msg={message[:80]} | t={time_sec:.0f}s")
                    flag_events.append((time_sec, abbr, flag_type))
        flag_events.sort(key=lambda e: e[0])
        logger.info(f"Parsed {len(flag_events)} flag events: {flag_events}")
    except Exception as e:
        logger.error(f"Failed to parse race control messages: {e}")

    # Build full RC message list for the RC feed
    rc_message_list: list[dict] = []
    try:
        if rcm is not None and len(rcm) > 0:
            for _, msg_row in rcm.iterrows():
                message = str(msg_row.get("Message", ""))
                if not message or message == "nan":
                    continue
                category = str(msg_row.get("Category", ""))
                racing_number = str(msg_row.get("RacingNumber", ""))
                if racing_number in ("nan", "None", "0"):
                    racing_number = ""
                msg_time = msg_row.get("Time")
                if pd.isna(msg_time):
                    continue
                if hasattr(msg_time, 'total_seconds'):
                    time_sec = msg_time.total_seconds()
                else:
                    try:
                        time_sec = (msg_time - min_date).total_seconds()
                    except Exception:
                        continue
                entry: dict = {"message": message, "category": category, "timestamp": time_sec}
                if racing_number and racing_number != "nan":
                    entry["racing_number"] = racing_number
                    # Map racing number to driver abbreviation
                    drv_abbr = number_to_abbr.get(racing_number, "")
                    if drv_abbr:
                        entry["driver"] = drv_abbr
                # Flag data for sector-level visualisation
                scope = str(msg_row.get("Scope", ""))
                if scope and scope != "nan":
                    entry["scope"] = scope
                flag_val = str(msg_row.get("Flag", ""))
                if flag_val and flag_val != "nan":
                    entry["flag"] = flag_val
                sector_num = msg_row.get("Sector")
                if not pd.isna(sector_num):
                    try:
                        entry["sector"] = int(sector_num)
                    except (ValueError, TypeError):
                        pass
                # Try to find lap number
                lap_num = msg_row.get("Lap")
                if not pd.isna(lap_num):
                    try:
                        entry["lap"] = int(lap_num)
                    except (ValueError, TypeError):
                        pass
                rc_message_list.append(entry)
            rc_message_list.sort(key=lambda e: e["timestamp"])
    except Exception as e:
        logger.error(f"Failed to build RC message list: {e}")

    # Build sector flag events timeline: [(timestamp, sector_num, flag, driver_abbr)]
    sector_flag_events: list[tuple[float, int, str, str]] = []
    for entry in rc_message_list:
        if entry.get("scope") == "Sector" and "sector" in entry and "flag" in entry:
            driver = entry.get("driver", "")
            sector_flag_events.append((entry["timestamp"], entry["sector"], entry["flag"], driver))

    def _get_sector_flags(frame_time: float) -> list[dict] | None:
        """Get active marshal sector flags at a given time."""
        # Track active flags per marshal sector
        active: dict[int, dict] = {}
        for evt_time, sector_num, flag, driver in sector_flag_events:
            if evt_time > frame_time:
                break
            if flag in ("CLEAR", "GREEN"):
                active.pop(sector_num, None)
            else:
                active[sector_num] = {"sector": sector_num, "flag": flag, "driver": driver}
        return list(active.values()) if active else None

    def _get_rc_messages(frame_time: float) -> list[dict]:
        """Get RC messages up to frame_time (newest first, max 50)."""
        msgs = [m for m in rc_message_list if m["timestamp"] <= frame_time]
        return list(reversed(msgs[-50:]))

    def _get_driver_flag(abbr: str, frame_time: float) -> str | None:
        """Get current flag state for a driver at a given time."""
        current = None
        for evt_time, evt_abbr, evt_type in flag_events:
            if evt_time > frame_time:
                break
            if evt_abbr == abbr:
                current = None if evt_type == "clear" else evt_type
        return current

    # Build lap lookup: for each driver, which lap are they on at a given time
    # Also build pit lane intervals (session timedelta seconds) for in-pit detection
    driver_lap_lookup = {}
    driver_pit_intervals: dict[str, list[tuple[float, float]]] = {}
    for drv in drivers_list:
        drv_laps_df = laps.pick_drivers(drv).sort_values("LapNumber")
        lap_entries = []
        pit_intervals = []
        pit_count = 0
        for _, lap_row in drv_laps_df.iterrows():
            lap_num = int(lap_row["LapNumber"])
            is_pit_in = lap_row.get("PitInTime") is not pd.NaT and pd.notna(lap_row.get("PitInTime"))
            is_pit_out = lap_row.get("PitOutTime") is not pd.NaT and pd.notna(lap_row.get("PitOutTime"))

            # Record entry BEFORE incrementing pit_count so the pit stop
            # only shows from the next lap (the out-lap), not the in-lap.
            lap_entries.append({
                "lap": lap_num,
                "compound": str(lap_row.get("Compound", "")) if pd.notna(lap_row.get("Compound")) else None,
                "tyre_life": int(lap_row["TyreLife"]) if pd.notna(lap_row.get("TyreLife")) else None,
                "position": int(lap_row["Position"]) if pd.notna(lap_row.get("Position")) else None,
                "pit_stops": pit_count,
            })

            # Build pit lane intervals and increment count after the entry
            if is_pit_in:
                pit_count += 1
                pit_in_sec = lap_row["PitInTime"].total_seconds()
                if is_pit_out:
                    pit_out_sec = lap_row["PitOutTime"].total_seconds()
                else:
                    pit_out_sec = pit_in_sec + 30.0
                pit_intervals.append((pit_in_sec, pit_out_sec))
            elif is_pit_out and not is_pit_in:
                # Out-lap only (pit_in was on previous lap row)
                pit_out_sec = lap_row["PitOutTime"].total_seconds()
                if pit_intervals and pit_intervals[-1][1] != pit_out_sec:
                    pit_intervals[-1] = (pit_intervals[-1][0], pit_out_sec)
        driver_lap_lookup[drv] = lap_entries
        driver_pit_intervals[drv] = pit_intervals

    # Build finish time lookup: session time (seconds) when each finished driver completed their final lap
    finished_driver_times: dict[str, float] = {}
    if is_race:
        for drv, final_laps in finished_driver_laps.items():
            try:
                drv_laps_df = laps.pick_drivers(drv).sort_values("LapNumber")
                final_lap_row = drv_laps_df[drv_laps_df["LapNumber"] == final_laps]
                if len(final_lap_row) > 0:
                    lap_time_td = final_lap_row.iloc[0].get("Time")
                    if pd.notna(lap_time_td) and hasattr(lap_time_td, "total_seconds"):
                        finished_driver_times[drv] = lap_time_td.total_seconds()
            except Exception:
                pass
        if finished_driver_times:
            logger.info(f"Finish times: {', '.join(f'{d}={t:.0f}s' for d, t in sorted(finished_driver_times.items(), key=lambda x: x[1]))}")

    # For non-race sessions (FP/Q/SQ): build best-lap-time lookup per driver
    # Each entry: (session_time_seconds_when_completed, lap_time_seconds)
    # sorted by session time so we can binary-search at each frame
    driver_best_lap_events: dict[str, list[tuple[float, float]]] = {}
    # Also track lap completion times per driver: (session_time, lap_number)
    driver_lap_completions: dict[str, list[tuple[float, int]]] = {}
    if not is_race:
        for drv in drivers_list:
            drv_laps_df = laps.pick_drivers(drv).sort_values("LapNumber")
            events = []
            completions = []
            for _, lap_row in drv_laps_df.iterrows():
                lt = lap_row.get("LapTime")
                completion_time = lap_row.get("Time")  # session timedelta when lap finished
                lap_num = int(lap_row["LapNumber"])
                if pd.notna(completion_time):
                    completions.append((completion_time.total_seconds(), lap_num))
                if pd.notna(lt) and pd.notna(completion_time):
                    events.append((completion_time.total_seconds(), lt.total_seconds()))
            driver_best_lap_events[drv] = events
            driver_lap_completions[drv] = completions

    # For qualifying and practice sessions: build sector completion events per driver
    # Each entry: (session_time, sector_num, sector_time_seconds, lap_number, is_out_lap)
    # Also pre-compute which laps are out laps (lap 1 or first lap after pit exit)
    driver_sector_events: dict[str, list[tuple[float, int, float, int, bool]]] = {}
    driver_out_laps: dict[str, set[int]] = {}
    if session_type in ("Q", "SQ", "FP1", "FP2", "FP3"):
        for drv in drivers_list:
            drv_laps_df = laps.pick_drivers(drv).sort_values("LapNumber")
            sector_events = []
            # Track which laps are out laps: lap 1 is always out lap,
            # and the first lap after a pit exit is an out lap
            out_lap_numbers = {1}  # lap 1 is always an out lap
            for _, lap_row in drv_laps_df.iterrows():
                is_pit_out = lap_row.get("PitOutTime") is not pd.NaT and pd.notna(lap_row.get("PitOutTime"))
                if is_pit_out:
                    # This lap has a pit exit — it's an out lap
                    out_lap_numbers.add(int(lap_row["LapNumber"]))

            for _, lap_row in drv_laps_df.iterrows():
                lap_num = int(lap_row["LapNumber"])
                is_out_lap = lap_num in out_lap_numbers
                for sec_num, sec_time_col, sec_session_col in [
                    (1, "Sector1Time", "Sector1SessionTime"),
                    (2, "Sector2Time", "Sector2SessionTime"),
                    (3, "Sector3Time", "Sector3SessionTime"),
                ]:
                    sec_session_t = lap_row.get(sec_session_col)
                    sec_time = lap_row.get(sec_time_col)
                    if pd.notna(sec_session_t) and pd.notna(sec_time):
                        sector_events.append((
                            sec_session_t.total_seconds(),
                            sec_num,
                            sec_time.total_seconds(),
                            lap_num,
                            is_out_lap,
                        ))
            sector_events.sort(key=lambda x: x[0])
            driver_sector_events[drv] = sector_events
            driver_out_laps[drv] = out_lap_numbers

    def _format_lap_time(seconds: float) -> str:
        """Format seconds as M:SS.sss lap time string."""
        mins = int(seconds // 60)
        secs = seconds - mins * 60
        return f"{mins}:{secs:06.3f}"

    # Compute session time offset: t_sec (from min_date) + session_time_offset = session timedelta
    # This is needed because gap data uses session timedeltas, not min_date offsets
    is_practice = session_type in ("FP1", "FP2", "FP3")
    session_time_offset = 0.0
    if is_practice and hasattr(session, "t0_date") and session.t0_date is not None:
        # For practice: use direct calculation from t0_date to min_date
        session_time_offset = (min_date - session.t0_date).total_seconds()
    else:
        for tel in driver_pos_data.values():
            if "SessionTime" in tel.columns and "Date" in tel.columns and len(tel) > 0:
                # Find the entry closest to min_date
                diffs = (tel["Date"] - min_date).abs()
                closest_idx = diffs.idxmin()
                st = tel.loc[closest_idx, "SessionTime"]
                if pd.notna(st):
                    session_time_offset = st.total_seconds()
                    break

    # Offset for timing the sector indicators. It must match the offset
    # laps.json uses for lap completion (`min_date - t0_date`) so sector markers
    # land exactly when the lap completes. In qualifying, session_time_offset is
    # later overwritten to the Q1 green-flag time (for the phase countdown), which
    # would make sectors trail lap completion by a few seconds — so we capture the
    # telemetry-aligned value here and use it only inside the sector block.
    sector_time_offset = (
        (min_date - session.t0_date).total_seconds()
        if getattr(session, "t0_date", None) is not None
        else session_time_offset
    )

    # Pre-compute track status (yellow/SC/VSC/red) lookup
    # track_status Time is a session timedelta, same as gap data
    track_status_times = np.array([], dtype=np.float64)
    track_status_codes = np.array([], dtype=int)
    STATUS_MAP = {1: "green", 2: "yellow", 4: "sc", 5: "red", 6: "vsc", 7: "green"}
    try:
        ts = session.track_status
        if ts is not None and len(ts) > 0:
            track_status_times = ts["Time"].dt.total_seconds().values.astype(np.float64)
            track_status_codes = ts["Status"].values.astype(int)
            logger.info(f"Loaded {len(ts)} track status entries")
    except Exception as e:
        logger.error(f"Failed to load track status: {e}")

    # Pre-compute qualifying phase data (Q1/Q2/Q3 green intervals)
    # Each entry: (phase_name, green_start_session_t, green_end_session_t, cumulative_green_before, phase_duration)
    quali_intervals: list[tuple[str, float, float, float, float]] = []
    is_quali = session_type in ("Q", "SQ")
    if is_quali:
        PHASE_DURATIONS = {"Q1": 1080.0, "Q2": 900.0, "Q3": 720.0}  # 18, 15, 12 min
        SQ_PHASE_DURATIONS = {"Q1": 720.0, "Q2": 600.0, "Q3": 480.0}  # 12, 10, 8 min (sprint)
        phase_durs = SQ_PHASE_DURATIONS if session_type == "SQ" else PHASE_DURATIONS
        try:
            ss = session.session_status
            if ss is not None and len(ss) > 0:
                # Build green intervals from Started->Finished/Aborted pairs
                # Track the end status so we can distinguish phase ends from red flags
                green_intervals: list[tuple[float, float, str]] = []  # (start, end, end_status)
                current_start = None
                for _, row in ss.iterrows():
                    t = row["Time"].total_seconds()
                    status = row["Status"]
                    if status == "Started":
                        current_start = t
                    elif status in ("Finished", "Aborted") and current_start is not None:
                        green_intervals.append((current_start, t, status))
                        current_start = None

                # Group intervals into Q1/Q2/Q3 phases
                # Only split on "Finished" boundaries (natural phase end)
                # "Aborted" means red flag/interruption — same phase resumes after restart
                phase_groups: list[list[tuple[float, float, str]]] = [[]]
                for i, (gs, ge, end_status) in enumerate(green_intervals):
                    phase_groups[-1].append((gs, ge, end_status))
                    if i < len(green_intervals) - 1 and end_status == "Finished":
                        phase_groups.append([])

                phase_names = ["Q1", "Q2", "Q3"]
                for pi, intervals in enumerate(phase_groups[:3]):
                    phase_name = phase_names[pi] if pi < len(phase_names) else f"Q{pi+1}"
                    phase_dur = phase_durs.get(phase_name, 720.0)
                    cumulative = 0.0
                    for gs, ge, _end_status in intervals:
                        quali_intervals.append((phase_name, gs, ge, cumulative, phase_dur))
                        cumulative += ge - gs

                logger.info(f"Qualifying phases: {[(name, f'{gs:.0f}-{ge:.0f}') for name, gs, ge, _, _ in quali_intervals]}")

                # Align session_time_offset to Q1 green start so countdown starts at full duration
                if quali_intervals:
                    session_time_offset = quali_intervals[0][1]
                    logger.info(f"Quali: set session_time_offset to Q1 green start ({session_time_offset:.1f}s)")

        except Exception as e:
            logger.error(f"Failed to parse qualifying phases: {e}")

    # Per-driver highest qualifying segment reached (1/2/3), read straight from
    # the results Q1/Q2/Q3 best-lap columns. Used to grey out drivers once a
    # later segment begins (they keep their position and posted time).
    driver_reached_phase: dict[str, int] = {}
    if is_quali:
        try:
            for _, row in session.results.iterrows():
                abbr = str(row.get("Abbreviation", ""))
                if not abbr:
                    continue
                reached = 0
                for idx, col in enumerate(("Q1", "Q2", "Q3"), start=1):
                    if col in row and pd.notna(row.get(col)):
                        reached = idx
                driver_reached_phase[abbr] = reached
        except Exception as e:
            logger.error(f"Failed to compute qualifying reached phases: {e}")

    def _get_quali_phase(t_sec: float) -> dict | None:
        """Get qualifying phase info at time t_sec."""
        if not quali_intervals:
            return None
        session_t = t_sec + session_time_offset
        for phase_name, gs, ge, cum_before, phase_dur in quali_intervals:
            if gs <= session_t <= ge:
                elapsed = cum_before + (session_t - gs)
                remaining = max(0.0, phase_dur - elapsed)
                return {"phase": phase_name, "elapsed": round(elapsed, 1), "remaining": round(remaining, 1)}
        # Between phases or before/after qualifying
        # Check if we're in a red flag gap within a phase (between Aborted end and next Started)
        last_phase = None
        last_cum = 0.0
        last_dur = 0.0
        for phase_name, gs, ge, cum_before, phase_dur in quali_intervals:
            if session_t < gs:
                # We're before this interval starts
                if last_phase == phase_name:
                    # Same phase — we're in a red flag gap, freeze the countdown
                    remaining = max(0.0, phase_dur - last_cum)
                    return {"phase": phase_name, "elapsed": round(last_cum, 1), "remaining": round(remaining, 1)}
                break
            last_phase = phase_name
            last_cum = cum_before + (ge - gs)
            last_dur = phase_dur
        if last_phase:
            return {"phase": last_phase, "elapsed": round(last_dur, 1), "remaining": 0.0}
        # Before any qualifying phase starts — show Q1 with full duration
        if quali_intervals:
            first_phase = quali_intervals[0][0]
            first_dur = quali_intervals[0][4]
            return {"phase": first_phase, "elapsed": 0.0, "remaining": round(first_dur, 1)}
        return None

    # Pre-compute weather data lookup
    weather_times = np.array([], dtype=np.float64)
    weather_air_temp = np.array([], dtype=np.float64)
    weather_track_temp = np.array([], dtype=np.float64)
    weather_humidity = np.array([], dtype=np.float64)
    weather_rainfall = np.array([], dtype=bool)
    weather_wind_speed = np.array([], dtype=np.float64)
    weather_wind_dir = np.array([], dtype=np.float64)
    try:
        wd = session.weather_data
        if wd is not None and len(wd) > 0:
            weather_times = wd["Time"].dt.total_seconds().values.astype(np.float64)
            weather_air_temp = wd["AirTemp"].values.astype(np.float64)
            weather_track_temp = wd["TrackTemp"].values.astype(np.float64)
            weather_humidity = wd["Humidity"].values.astype(np.float64)
            weather_rainfall = wd["Rainfall"].values.astype(bool)
            weather_wind_speed = wd["WindSpeed"].values.astype(np.float64)
            weather_wind_dir = wd["WindDirection"].values.astype(np.float64)
            logger.info(f"Loaded {len(wd)} weather entries")
    except Exception as e:
        logger.error(f"Failed to load weather data: {e}")

    def _get_weather(t_sec: float) -> dict | None:
        """Get weather data at time t_sec."""
        if len(weather_times) == 0:
            return None
        session_t = t_sec + session_time_offset
        idx = np.searchsorted(weather_times, session_t, side="right") - 1
        if idx < 0:
            idx = 0
        return {
            "air_temp": round(float(weather_air_temp[idx]), 1),
            "track_temp": round(float(weather_track_temp[idx]), 1),
            "humidity": round(float(weather_humidity[idx]), 0),
            "rainfall": bool(weather_rainfall[idx]),
            "wind_speed": round(float(weather_wind_speed[idx]), 1),
            "wind_direction": int(weather_wind_dir[idx]),
        }

    def _get_track_status(t_sec: float) -> str:
        """Get track status (green/yellow/sc/vsc/red) at time t_sec."""
        if len(track_status_times) == 0:
            return "green"
        session_t = t_sec + session_time_offset
        idx = np.searchsorted(track_status_times, session_t, side="right") - 1
        if idx < 0:
            return "green"
        code = int(track_status_codes[idx])
        return STATUS_MAP.get(code, "green")

    def _get_red_flag_end(t_sec: float) -> float | None:
        """If currently red-flagged, return the replay timestamp when session goes non-red."""
        if len(track_status_times) == 0:
            return None
        session_t = t_sec + session_time_offset
        idx = np.searchsorted(track_status_times, session_t, side="right") - 1
        if idx < 0:
            return None
        if int(track_status_codes[idx]) != 5:
            return None
        for j in range(idx + 1, len(track_status_codes)):
            if int(track_status_codes[j]) != 5:
                return float(track_status_times[j] - session_time_offset)
        return None

    # Pre-convert telemetry to numpy arrays for fast lookup via searchsorted
    driver_arrays: dict[str, dict] = {}
    for drv, tel in driver_pos_data.items():
        if "Date" not in tel.columns or len(tel) == 0:
            continue
        times = (tel["Date"] - min_date).dt.total_seconds().values.astype(np.float64)
        sort_idx = np.argsort(times)
        times = times[sort_idx]
        x_vals = ((tel["X"].values[sort_idx] - x_min) / scale).astype(np.float64)
        y_vals = ((tel["Y"].values[sort_idx] - y_min) / scale).astype(np.float64)
        rel_dist = tel["RelativeDistance"].values[sort_idx].astype(np.float64) if "RelativeDistance" in tel.columns else np.zeros(len(times))
        speed = tel["Speed"].values[sort_idx].astype(np.float64) if "Speed" in tel.columns else np.zeros(len(times))
        throttle = tel["Throttle"].values[sort_idx].astype(np.float64) if "Throttle" in tel.columns else np.zeros(len(times))
        brake = tel["Brake"].values[sort_idx] if "Brake" in tel.columns else np.zeros(len(times), dtype=bool)
        gear = tel["nGear"].values[sort_idx].astype(int) if "nGear" in tel.columns else np.zeros(len(times), dtype=int)
        rpm = tel["RPM"].values[sort_idx].astype(np.float64) if "RPM" in tel.columns else np.zeros(len(times))
        drs = tel["DRS"].values[sort_idx].astype(int) if "DRS" in tel.columns else np.zeros(len(times), dtype=int)
        driver_arrays[drv] = {
            "times": times,
            "x": x_vals,
            "y": y_vals,
            "rel_dist": rel_dist,
            "speed": speed,
            "throttle": throttle,
            "brake": brake,
            "gear": gear,
            "rpm": rpm,
            "drs": drs,
        }

    logger.info(f"Pre-processed {len(driver_arrays)} drivers for frame generation, {min(num_samples, 50000)} frames to build")

    # Load real-time gap-to-leader data from F1 timing feed
    # abbr -> (times_array, gap_strings_array)
    timing_lookup: dict[str, tuple] = {}
    # abbr -> (times_array, interval_strings_array)
    interval_lookup: dict[str, tuple] = {}
    try:
        _, timing_df = f1api.timing_data(session.api_path)
        if timing_df is not None and "GapToLeader" in timing_df.columns:
            has_interval = "IntervalToPositionAhead" in timing_df.columns
            num_to_abbr = {}
            for _, row in session.results.iterrows():
                num_to_abbr[str(row.get("DriverNumber", ""))] = str(row.get("Abbreviation", ""))

            for drv_num in timing_df["Driver"].unique():
                abbr = num_to_abbr.get(str(drv_num))
                if not abbr:
                    continue
                drv_data = timing_df[timing_df["Driver"] == drv_num].sort_values("Time")
                times = drv_data["Time"].dt.total_seconds().values.astype(np.float64)
                gap_strs = drv_data["GapToLeader"].values
                timing_lookup[abbr] = (times, gap_strs)
                if has_interval:
                    interval_vals = drv_data["IntervalToPositionAhead"].values
                    interval_lookup[abbr] = (times, interval_vals)
            logger.info(f"Loaded F1 timing data for {len(timing_lookup)} drivers ({len(timing_df)} entries), intervals={'yes' if has_interval else 'no'}")
    except Exception as e:
        logger.error(f"Failed to load timing data: {e}")

    def _get_gap_to_leader(abbr: str, t_sec: float) -> str | None:
        """Get the most recent GapToLeader string for a driver at time t_sec."""
        entry = timing_lookup.get(abbr)
        if entry is None:
            return None
        times, gap_strs = entry
        session_t = t_sec + session_time_offset
        idx = np.searchsorted(times, session_t, side="right") - 1
        if idx < 0:
            return None
        val = gap_strs[idx]
        if pd.isna(val) or val is None:
            return None
        return str(val)

    def _get_interval(abbr: str, t_sec: float) -> str | None:
        """Get the most recent IntervalToPositionAhead for a driver at time t_sec."""
        entry = interval_lookup.get(abbr)
        if entry is None:
            return None
        times, interval_vals = entry
        session_t = t_sec + session_time_offset
        idx = np.searchsorted(times, session_t, side="right") - 1
        if idx < 0:
            return None
        val = interval_vals[idx]
        if pd.isna(val) or val is None:
            return None
        return str(val)

    def _gap_sort_key(gap_str: str | None) -> float:
        """Convert gap string to a sortable number. Leader (LAP X) = 0, +N.NNN = N.NNN, lapped = 9000+N, None = inf."""
        if gap_str is None:
            return float("inf")
        if gap_str.startswith("LAP"):
            return 0.0
        # Lapped cars: "1L", "1 L", "2L" etc  - sort after all non-lapped drivers
        import re
        lapped = re.match(r"^(\d+)\s*L$", gap_str)
        if lapped:
            return 9000.0 + int(lapped.group(1))
        try:
            return float(gap_str.lstrip("+"))
        except ValueError:
            return float("inf")

    # Track last known state for each driver (for showing retired drivers)
    last_known: dict[str, dict] = {}
    # Track drivers that have ever appeared in telemetry
    ever_seen: set[str] = set()

    for i in range(min(num_samples, 50000)):  # cap to prevent excessive data
        t_sec = i * sample_interval
        frame_drivers = []
        seen_drivers = set()

        # Collect each driver's track coordinates and gap data
        for drv, arrays in driver_arrays.items():
            times = arrays["times"]
            idx = np.searchsorted(times, t_sec, side="left")
            if idx >= len(times):
                idx = len(times) - 1
            elif idx > 0:
                if abs(times[idx - 1] - t_sec) < abs(times[idx] - t_sec):
                    idx = idx - 1

            time_diff = abs(times[idx] - t_sec)
            if time_diff > 10:
                continue

            seen_drivers.add(drv)
            ever_seen.add(drv)
            def _safe_float(v) -> float:
                f = float(v)
                return 0.0 if np.isnan(f) or np.isinf(f) else f
            x_norm = _safe_float(arrays["x"][idx])
            y_norm = _safe_float(arrays["y"][idx])
            rel_dist = _safe_float(arrays["rel_dist"][idx])
            spd = _safe_float(arrays["speed"][idx])
            thr = _safe_float(arrays["throttle"][idx])
            brk = bool(arrays["brake"][idx])
            gr = int(arrays["gear"][idx]) if not np.isnan(arrays["gear"][idx]) else 0
            rpms = _safe_float(arrays["rpm"][idx])
            drs_val = int(arrays["drs"][idx]) if not np.isnan(arrays["drs"][idx]) else 0

            gap = _get_gap_to_leader(drv, t_sec) if is_race else None
            interval = _get_interval(drv, t_sec) if is_race else None
            grid_pos = grid_positions.get(drv) if is_race else None
            is_pit_lane_starter = grid_pos == 0 if is_race else False
            show_pit_badge = is_pit_lane_starter and t_sec < 10

            # Check if driver is currently in the pit lane
            session_t = t_sec + session_time_offset
            in_pit = False
            pit_time = None
            for pit_in, pit_out in driver_pit_intervals.get(drv, []):
                if pit_in <= session_t <= pit_out:
                    in_pit = True
                    pit_time = round(session_t - pit_in, 1)
                    break

            # Tyre/pit data filled in after current lap is determined (below)

            drv_data = {
                "abbr": drv,
                "x": x_norm,
                "y": y_norm,
                "color": colors.get(drv, "#FFFFFF"),
                "team": teams.get(drv, ""),
                "position": None,  # assigned after sorting by gap
                "grid_position": grid_pos if not is_pit_lane_starter else None,
                "pit_start": show_pit_badge,
                "in_pit": in_pit,
                "pit_time": pit_time,
                "finished": drv in finished_driver_times and session_t >= finished_driver_times[drv],
                "compound": None,
                "tyre_life": None,
                "pit_stops": 0,
                "has_fastest_lap": False,  # set after sorting
                "flag": _get_driver_flag(drv, t_sec),
                "gap": gap,
                "interval": interval,
                "best_lap_time": None,
                "no_timing": gap is None,
                "retired": False,
                "relative_distance": rel_dist,
                "speed": spd,
                "throttle": thr,
                "brake": brk,
                "gear": gr,
                "rpm": rpms,
                "drs": drs_val,
            }
            last_known[drv] = drv_data
            frame_drivers.append(drv_data)

        # Add drivers that have dropped out of telemetry back to the frame
        # so they always appear on the leaderboard
        for drv in driver_arrays:
            if drv not in seen_drivers and drv in last_known:
                is_retired = drv in retired_drivers
                is_finished = drv in finished_drivers
                if is_finished:
                    # Keep last known gap and position for finished drivers
                    restored = {**last_known[drv]}
                    restored["finished"] = True
                    restored["no_timing"] = False
                    restored["retired"] = False
                    # Use final classified position
                    restored["position"] = finished_drivers[drv]
                elif is_retired:
                    restored = {**last_known[drv], "gap": None, "interval": None}
                    restored["retired"] = True
                    restored["no_timing"] = False
                else:
                    restored = {**last_known[drv], "gap": None, "interval": None}
                    # Telemetry gap — grey out but keep on leaderboard
                    restored["no_timing"] = True
                frame_drivers.append(restored)

        # Add drivers who have grid positions but never appeared in telemetry
        # (e.g. DNS — crashed before formation lap). Show as "Out" after 10s.
        if is_race and t_sec >= 10:
            for drv, gp in grid_positions.items():
                if drv not in seen_drivers and drv not in ever_seen:
                    frame_drivers.append({
                        "abbr": drv,
                        "x": 0.0,
                        "y": 0.0,
                        "color": colors.get(drv, "#FFFFFF"),
                        "team": teams.get(drv, ""),
                        "position": None,
                        "grid_position": gp if gp and gp > 0 else None,
                        "pit_start": False,
                        "in_pit": False,
                        "compound": None,
                        "tyre_life": None,
                        "pit_stops": 0,
                        "has_fastest_lap": False,
                        "flag": None,
                        "gap": None,
                        "interval": None,
                        "no_timing": False,
                        "retired": True,
                        "relative_distance": 0.0,
                        "speed": 0.0,
                        "throttle": 0.0,
                        "brake": False,
                        "gear": 0,
                        "rpm": 0.0,
                        "drs": 0,
                        "tyre_history": [],
                    })

        if is_race:
            # First 10 seconds: use telemetry for track map x/y,
            # but lock leaderboard positions to grid order
            if t_sec < 10:
                # Add drivers missing from telemetry so they appear on leaderboard
                for drv, gp in grid_positions.items():
                    if gp is None or drv in seen_drivers:
                        continue
                    is_pit_lane = gp == 0
                    frame_drivers.append({
                        "abbr": drv,
                        "x": 0.0,
                        "y": 0.0,
                        "color": colors.get(drv, "#FFFFFF"),
                        "team": teams.get(drv, ""),
                        "position": None,
                        "grid_position": gp if not is_pit_lane else None,
                        "pit_start": is_pit_lane,
                        "in_pit": False,
                        "compound": None,
                        "tyre_life": None,
                        "pit_stops": 0,
                        "has_fastest_lap": False,
                        "flag": None,
                        "gap": None,
                        "interval": None,
                        "no_timing": True,
                        "retired": False,
                        "relative_distance": 0.0,
                        "speed": 0.0,
                        "throttle": 0.0,
                        "brake": False,
                        "gear": 0,
                        "rpm": 0.0,
                        "drs": 0,
                        "tyre_history": [],
                    })
                # Override positions with grid order for all drivers
                # All drivers appear normal on leaderboard during first 10 seconds
                for d in frame_drivers:
                    gp = grid_positions.get(d["abbr"])
                    d["position"] = gp if gp and gp > 0 else None
                    d["gap"] = None
                    d["no_timing"] = False
                frame_drivers.sort(key=lambda d: (d["position"] is None, d["position"] or 0))
            else:
                # Derive positions by sorting on gap-to-leader
                # Finished drivers keep their classified position and sort first
                finished_in_frame = [d for d in frame_drivers if d.get("finished")]
                active_in_frame = [d for d in frame_drivers if not d.get("finished")]
                active_in_frame.sort(key=lambda d: _gap_sort_key(d["gap"]))
                # Assign final classified position to finished drivers
                for d in finished_in_frame:
                    final_pos = finished_drivers.get(d["abbr"])
                    if final_pos:
                        d["position"] = final_pos
                finished_in_frame.sort(key=lambda d: d.get("position") or 9999)
                # Combine: finished first (in order), then active (by gap)
                frame_drivers = finished_in_frame + active_in_frame
                for pos, d in enumerate(frame_drivers, 1):
                    if not d.get("finished"):
                        d["position"] = pos
        else:
            # Non-race sessions: sort by best lap time
            session_t_now = t_sec + session_time_offset

            # Per-driver: only show a time once that driver has completed
            # at least 2 laps (lap 1 is always the out-lap)
            driver_best_times: dict[str, float] = {}
            for d in frame_drivers:
                # Check if this driver has completed lap 2+ (a flying lap)
                drv_has_flying_lap = False
                for comp_t, lap_num in driver_lap_completions.get(d["abbr"], []):
                    if lap_num >= 2 and comp_t <= session_t_now:
                        drv_has_flying_lap = True
                        break
                if not drv_has_flying_lap:
                    continue
                events = driver_best_lap_events.get(d["abbr"], [])
                best = None
                for completion_t, lap_t in events:
                    if completion_t <= session_t_now:
                        if best is None or lap_t < best:
                            best = lap_t
                    else:
                        break
                if best is not None:
                    driver_best_times[d["abbr"]] = best

            # Sort: retired drivers at bottom, then drivers with times by best time, then no-time drivers
            frame_drivers.sort(key=lambda d: (
                2 if d.get("retired") else (0 if d["abbr"] in driver_best_times else 1),
                driver_best_times.get(d["abbr"], float("inf")),
            ))
            fastest_time = None
            for pos, d in enumerate(frame_drivers, 1):
                d["position"] = pos
                best = driver_best_times.get(d["abbr"])
                if best is not None:
                    d["best_lap_time"] = _format_lap_time(best)
                    if fastest_time is None:
                        fastest_time = best
                        d["gap"] = _format_lap_time(best)
                    else:
                        d["gap"] = f"+{best - fastest_time:.3f}"
                    d["no_timing"] = False
                else:
                    d["best_lap_time"] = None
                    d["gap"] = "No time"
                    d["no_timing"] = False

            # Qualifying: flag drivers knocked out in an earlier segment so the
            # frontend can dim them. They keep their position and posted time.
            if is_quali:
                phase = _get_quali_phase(t_sec)
                phase_idx = {"Q1": 1, "Q2": 2, "Q3": 3}.get(phase["phase"], 1) if phase else 1
                for d in frame_drivers:
                    reached = driver_reached_phase.get(d["abbr"], 0)
                    d["knocked_out"] = phase_idx >= 2 and reached < phase_idx

            # Add live sector indicators for qualifying and practice
            if session_type in ("Q", "SQ", "FP1", "FP2", "FP3"):
                # Time sector markers with the lap-completion offset (not the
                # quali countdown's session_time_offset) so they appear exactly
                # when the lap completes, in sync with the last-lap time.
                session_t_sectors = t_sec + sector_time_offset

                # Track overall best and personal best sector times up to now
                overall_best_sectors: dict[int, float] = {}  # sector_num -> best time
                personal_best_sectors: dict[str, dict[int, float]] = {}  # driver -> sector_num -> best time

                # First pass: compute bests from all completed sectors up to now
                for drv_abbr in drivers_list:
                    pb: dict[int, float] = {}
                    for evt_t, sec_num, sec_time, lap_num, is_out_lap in driver_sector_events.get(drv_abbr, []):
                        if evt_t > session_t_sectors:
                            break
                        if is_out_lap:
                            continue
                        # Update personal best
                        if sec_num not in pb or sec_time < pb[sec_num]:
                            pb[sec_num] = sec_time
                        # Update overall best
                        if sec_num not in overall_best_sectors or sec_time < overall_best_sectors[sec_num]:
                            overall_best_sectors[sec_num] = sec_time
                    personal_best_sectors[drv_abbr] = pb

                # Second pass: for each driver, find current lap sectors
                SECTOR_LINGER = 5.0  # seconds to keep showing all 3 sectors after S3

                for d in frame_drivers:
                    drv_abbr = d["abbr"]
                    events = driver_sector_events.get(drv_abbr, [])

                    def _collect_sectors_for_lap(target_lap: int) -> list[dict]:
                        """Collect completed sector indicators for a specific lap."""
                        result = []
                        for evt_t2, sec_num2, sec_time2, lap_num2, is_out_lap2 in events:
                            if evt_t2 > session_t_sectors:
                                break
                            if lap_num2 == target_lap and not is_out_lap2:
                                pb = personal_best_sectors.get(drv_abbr, {})
                                ob = overall_best_sectors.get(sec_num2)
                                if ob is not None and sec_time2 <= ob + 0.0005:
                                    color = "purple"
                                elif sec_num2 in pb and sec_time2 <= pb[sec_num2] + 0.0005:
                                    color = "green"
                                else:
                                    color = "yellow"
                                result.append({"num": sec_num2, "color": color})
                        return result

                    # Find the most recent sector event to determine what lap we're on
                    last_evt_lap = None
                    last_evt_sec = None
                    last_evt_time = None
                    last_evt_out = False
                    for evt_t, sec_num, sec_time, lap_num, is_out_lap in reversed(events):
                        if evt_t <= session_t_sectors:
                            last_evt_lap = lap_num
                            last_evt_sec = sec_num
                            last_evt_time = evt_t
                            last_evt_out = is_out_lap
                            break

                    # Check if the driver has moved to a newer lap (no sectors yet)
                    current_lap_num = last_evt_lap
                    is_current_out_lap = last_evt_out
                    for comp_t, comp_lap in driver_lap_completions.get(drv_abbr, []):
                        if comp_t <= session_t_sectors:
                            if current_lap_num is None or comp_lap >= current_lap_num:
                                current_lap_num = comp_lap + 1
                                is_current_out_lap = current_lap_num in driver_out_laps.get(drv_abbr, set())
                        else:
                            break

                    if current_lap_num is None:
                        d["sectors"] = None
                        continue

                    # If we're on the same lap as the last sector event, show that lap's sectors
                    if current_lap_num == last_evt_lap and not last_evt_out:
                        sectors = _collect_sectors_for_lap(current_lap_num)
                        d["sectors"] = sectors if sectors else None
                        continue

                    # We've moved to a new lap — check if we should linger the previous lap's S3
                    if last_evt_sec == 3 and not last_evt_out and last_evt_time is not None:
                        if session_t_sectors - last_evt_time <= SECTOR_LINGER:
                            # Show the completed previous lap's sectors for a few more seconds
                            sectors = _collect_sectors_for_lap(last_evt_lap)
                            d["sectors"] = sectors if sectors else None
                            continue

                    # On an out lap or past the linger period
                    if is_current_out_lap:
                        d["sectors"] = None
                    else:
                        sectors = _collect_sectors_for_lap(current_lap_num)
                        d["sectors"] = sectors if sectors else None

        # Determine current lap from leader's gap ("LAP N") and assign fastest lap
        current_lap = 1
        if is_race and frame_drivers:
            leader_gap = frame_drivers[0].get("gap")
            if leader_gap and leader_gap.startswith("LAP "):
                try:
                    current_lap = int(leader_gap.split(" ")[1])
                except (ValueError, IndexError):
                    pass
            completed_lap = current_lap - 1
            if completed_lap > 0:
                fl_holder = fastest_by_lap.get(completed_lap)
                if fl_holder:
                    for d in frame_drivers:
                        if d["abbr"] == fl_holder:
                            d["has_fastest_lap"] = True
                            break

        # Fill in tyre/pit data using timestamps for accuracy
        session_t = t_sec + session_time_offset
        for d in frame_drivers:
            lap_info = driver_lap_lookup.get(d["abbr"], [])
            intervals = driver_pit_intervals.get(d["abbr"], [])

            # Count completed pit stops (driver has exited pit)
            completed_pits = sum(1 for _, pit_out in intervals if session_t >= pit_out)
            d["pit_stops"] = completed_pits

            # For non-race: determine per-driver current lap from session time
            if is_race:
                drv_current_lap = current_lap
            else:
                drv_current_lap = 0
                for comp_t, lap_num in driver_lap_completions.get(d["abbr"], []):
                    if comp_t <= session_t:
                        drv_current_lap = lap_num
                    else:
                        break

            # Build tyre stints from lap data: each compound change is a stint
            stints: list[str] = []
            prev_compound = None
            tyre_life_by_stint: list[int | None] = []
            for entry in lap_info:
                if entry["lap"] <= drv_current_lap:
                    c = entry["compound"]
                    if c and c != prev_compound:
                        stints.append(c)
                        prev_compound = c
                    # Track tyre life for latest entry in current stint
                    if stints:
                        if len(tyre_life_by_stint) < len(stints):
                            tyre_life_by_stint.append(entry["tyre_life"])
                        else:
                            tyre_life_by_stint[-1] = entry["tyre_life"]

            # Only show stints up to completed_pits + 1 (current stint)
            visible_stints = stints[:completed_pits + 1]
            tyre_history = visible_stints[:-1] if len(visible_stints) > 1 else []
            compound = visible_stints[-1] if visible_stints else (lap_info[0]["compound"] if lap_info else None)
            tyre_life = tyre_life_by_stint[len(visible_stints) - 1] if len(visible_stints) > 0 and len(tyre_life_by_stint) >= len(visible_stints) else (lap_info[0]["tyre_life"] if lap_info else None)

            d["compound"] = compound
            d["tyre_life"] = tyre_life
            d["tyre_history"] = tyre_history

        frame = {
            "timestamp": i * sample_interval,
            "lap": current_lap,
            "total_laps": total_laps,
            "session_type": session_type,
            "drivers": frame_drivers,
            "status": _get_track_status(i * sample_interval),
        }
        weather = _get_weather(i * sample_interval)
        if weather:
            frame["weather"] = weather
        quali_phase = _get_quali_phase(i * sample_interval)
        if quali_phase:
            frame["quali_phase"] = quali_phase
        rc_msgs = _get_rc_messages(i * sample_interval)
        if rc_msgs:
            frame["rc_messages"] = rc_msgs
        s_flags = _get_sector_flags(i * sample_interval)
        if s_flags:
            frame["sector_flags"] = s_flags
        if frame["status"] == "red":
            rfe = _get_red_flag_end(i * sample_interval)
            if rfe is not None:
                frame["red_flag_end"] = round(rfe, 1)
        frames.append(frame)

    return frames


async def get_driver_positions_by_time(
    year: int, round_num: int, session_type: str = "R"
) -> list[dict]:
    return await asyncio.to_thread(_get_driver_positions_by_time_sync, year, round_num, session_type)
