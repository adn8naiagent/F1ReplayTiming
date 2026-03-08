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
                    "date_utc": str(date_utc) if pd.notna(date_utc) else None,
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


def _get_track_data_sync(year: int, round_num: int, session_type: str = "R") -> dict:
    session = _load_session(year, round_num, session_type)

    rotation = 0.0
    try:
        circuit_info = session.get_circuit_info()
        rotation = float(circuit_info.rotation) if hasattr(circuit_info, "rotation") else 0.0
    except Exception:
        pass

    # Get track coordinates from fastest lap telemetry
    fastest_lap = session.laps.pick_fastest()
    telemetry = fastest_lap.get_telemetry()

    if telemetry is None or "X" not in telemetry.columns or len(telemetry) == 0:
        raise ValueError("Telemetry data not available for this session")

    x = telemetry["X"].values
    y = telemetry["Y"].values

    # Normalize to 0-1 range for frontend flexibility
    x_min, x_max = float(x.min()), float(x.max())
    y_min, y_max = float(y.min()), float(y.max())
    scale = max(x_max - x_min, y_max - y_min)
    if scale == 0:
        scale = 1

    x_norm = ((x - x_min) / scale).tolist()
    y_norm = ((y - y_min) / scale).tolist()

    return {
        "track_points": [{"x": px, "y": py} for px, py in zip(x_norm, y_norm)],
        "rotation": rotation,
        "circuit_name": str(session.event.get("Location", "")),
        # Raw normalization params so driver positions use the same reference
        "norm": {"x_min": x_min, "y_min": y_min, "scale": scale},
    }


async def get_track_data(year: int, round_num: int, session_type: str = "R") -> dict:
    return await asyncio.to_thread(_get_track_data_sync, year, round_num, session_type)


def _get_lap_data_sync(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    session = _load_session(year, round_num, session_type)
    laps = session.laps

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

        result.append({
            "driver": str(lap.get("Driver", "")),
            "lap_number": int(lap.get("LapNumber", 0)),
            "position": int(lap["Position"]) if pd.notna(lap.get("Position")) else None,
            "lap_time": fmt_time(lap.get("LapTime")),
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

    # Use the same normalization as the track outline (fastest lap)
    # so driver dots align exactly with the drawn track
    fastest_lap = laps.pick_fastest()
    fastest_tel = fastest_lap.get_telemetry()
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
        if status and status not in ("Finished", "") and not status.startswith("+"):
            retired_drivers.add(abbr)
        grid = row.get("GridPosition")
        if pd.notna(grid):
            grid_val = int(grid)
            grid_positions[abbr] = grid_val

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
    try:
        rcm = session.race_control_messages
        logger.info(f"Race control messages: {len(rcm) if rcm is not None else 'None'} entries")
        if rcm is not None and len(rcm) > 0:
            logger.info(f"RCM columns: {list(rcm.columns)}")
            for _, msg_row in rcm.iterrows():
                racing_number = str(msg_row.get("RacingNumber", ""))
                if not racing_number or racing_number == "nan" or racing_number == "":
                    continue
                abbr = number_to_abbr.get(racing_number)
                if not abbr:
                    # Try without leading zeros
                    abbr = number_to_abbr.get(racing_number.lstrip("0"))
                if not abbr:
                    continue
                msg_time = msg_row.get("Time")
                if pd.isna(msg_time):
                    continue
                # Time may be Timestamp or Timedelta  - handle both
                if hasattr(msg_time, 'total_seconds'):
                    time_sec = msg_time.total_seconds()
                else:
                    # Timestamp  - convert to offset from min_date
                    try:
                        time_sec = (msg_time - min_date).total_seconds()
                    except Exception:
                        continue
                message = str(msg_row.get("Message", "")).upper()
                category = str(msg_row.get("Category", "")).upper()

                logger.info(f"RCM: {abbr} | cat={category} | msg={message[:80]} | t={time_sec:.0f}s")

                if "NO FURTHER ACTION" in message or "CLEARED" in message:
                    flag_events.append((time_sec, abbr, "clear"))
                elif "PENALTY" in message or "PENALTY" in category:
                    flag_events.append((time_sec, abbr, "penalty"))
                elif "INVESTIGATION" in message or "INVESTIGATION" in category or "NOTED" in message:
                    flag_events.append((time_sec, abbr, "investigation"))
        flag_events.sort(key=lambda e: e[0])
        logger.info(f"Parsed {len(flag_events)} flag events: {flag_events}")
    except Exception as e:
        logger.error(f"Failed to parse race control messages: {e}")

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

    def _format_lap_time(seconds: float) -> str:
        """Format seconds as M:SS.sss lap time string."""
        mins = int(seconds // 60)
        secs = seconds - mins * 60
        return f"{mins}:{secs:06.3f}"

    # Compute session time offset: t_sec (from min_date) + session_time_offset = session timedelta
    # This is needed because gap data uses session timedeltas, not min_date offsets
    session_time_offset = 0.0
    for tel in driver_pos_data.values():
        if "SessionTime" in tel.columns and "Date" in tel.columns and len(tel) > 0:
            # Find the entry closest to min_date
            diffs = (tel["Date"] - min_date).abs()
            closest_idx = diffs.idxmin()
            st = tel.loc[closest_idx, "SessionTime"]
            if pd.notna(st):
                session_time_offset = st.total_seconds()
                break

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
    try:
        _, timing_df = f1api.timing_data(session.api_path)
        if timing_df is not None and "GapToLeader" in timing_df.columns:
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
            logger.info(f"Loaded F1 timing data for {len(timing_lookup)} drivers ({len(timing_df)} entries)")
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
            grid_pos = grid_positions.get(drv) if is_race else None
            is_pit_lane_starter = grid_pos == 0 if is_race else False
            show_pit_badge = is_pit_lane_starter and t_sec < 10

            # Check if driver is currently in the pit lane
            session_t = t_sec + session_time_offset
            in_pit = False
            for pit_in, pit_out in driver_pit_intervals.get(drv, []):
                if pit_in <= session_t <= pit_out:
                    in_pit = True
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
                "compound": None,
                "tyre_life": None,
                "pit_stops": 0,
                "has_fastest_lap": False,  # set after sorting
                "flag": _get_driver_flag(drv, t_sec),
                "gap": gap,
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

        # Add retired drivers that have dropped out of telemetry
        for drv in driver_arrays:
            if drv not in seen_drivers and drv in last_known and drv in retired_drivers:
                retired_data = {**last_known[drv], "retired": True, "gap": None, "no_timing": False}
                frame_drivers.append(retired_data)

        if is_race:
            # First 10 seconds: use grid positions, no gap display, no greying
            if t_sec < 10:
                for d in frame_drivers:
                    gp = grid_positions.get(d["abbr"])
                    d["position"] = gp if gp and gp > 0 else len(frame_drivers)
                    d["gap"] = None
                    d["no_timing"] = False
                frame_drivers.sort(key=lambda d: d["position"])
            else:
                # Derive positions by sorting on gap-to-leader
                # Drivers with gap data are ranked by gap value; drivers without go to the bottom
                frame_drivers.sort(key=lambda d: _gap_sort_key(d["gap"]))
                for pos, d in enumerate(frame_drivers, 1):
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

            # Sort: drivers with times by best time, drivers without at bottom
            frame_drivers.sort(key=lambda d: driver_best_times.get(d["abbr"], float("inf")))
            fastest_time = None
            for pos, d in enumerate(frame_drivers, 1):
                d["position"] = pos
                best = driver_best_times.get(d["abbr"])
                if best is not None:
                    if fastest_time is None:
                        fastest_time = best
                        d["gap"] = _format_lap_time(best)
                    else:
                        d["gap"] = f"+{best - fastest_time:.3f}"
                    d["no_timing"] = False
                else:
                    d["gap"] = "No time"
                    d["no_timing"] = False

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
        frames.append(frame)

    return frames


async def get_driver_positions_by_time(
    year: int, round_num: int, session_type: str = "R"
) -> list[dict]:
    return await asyncio.to_thread(_get_driver_positions_by_time_sync, year, round_num, session_type)
