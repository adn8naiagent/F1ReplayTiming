import asyncio
import logging
import time
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json, put_json, list_sizes
from services.process import (
    ensure_session_data,
    start_reprocess,
    get_reprocess_status,
    delete_session,
)
from services.retention import (
    RetentionError,
    get_retention,
    save_retention,
    session_index,
    sweep,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sessions"])

AVAILABLE_SEASONS = list(range(2024, 2029))

SESSION_NAME_TO_TYPE = {
    "Race": "R",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
}

# Cache: year -> (events_data, timestamp)
_events_cache: dict[int, tuple[dict, float]] = {}
_CACHE_TTL = 300  # 5 minutes


def _build_events(year: int) -> dict:
    """Build events response with availability based on session dates."""
    data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        return None

    data = deepcopy(data)
    events = data.get("events", [])
    now = datetime.now(timezone.utc)
    last_past_idx = None

    # One storage listing for the whole season; used to mark which sessions
    # have already been pre-computed (replay.json present) and their total size.
    try:
        sizes = list_sizes(f"sessions/{year}")
    except Exception:
        sizes = {}

    for i, evt in enumerate(events):
        has_past_session = False
        rnd = evt.get("round_number")
        for session in evt.get("sessions", []):
            date_str = session.get("date_utc")
            if date_str:
                try:
                    session_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    if session_dt.tzinfo is None:
                        session_dt = session_dt.replace(tzinfo=timezone.utc)
                    # Available if the session date is in the past
                    session["available"] = session_dt < now
                    if session["available"]:
                        has_past_session = True
                except (ValueError, TypeError):
                    session["available"] = False
            else:
                session["available"] = False

            # Pre-compute status + stored size (replay.json is the definitive
            # marker that a session has been fully processed).
            code = SESSION_NAME_TO_TYPE.get(session.get("name", ""))
            if code and rnd is not None:
                prefix = f"sessions/{year}/{rnd}/{code}/"
                precomputed = (prefix + "replay.json") in sizes
                session["precomputed"] = precomputed
                session["size_bytes"] = (
                    sum(v for k, v in sizes.items() if k.startswith(prefix))
                    if precomputed else 0
                )
            else:
                session["precomputed"] = False
                session["size_bytes"] = 0

        # Normalize date_utc to ISO 8601 with "Z" so the browser
        # correctly interprets them as UTC and converts to local time
        for session in evt.get("sessions", []):
            d = session.get("date_utc")
            if d and not d.endswith("Z"):
                session["date_utc"] = d.replace(" ", "T") + "Z"

        if has_past_session:
            evt["status"] = "available"
            last_past_idx = i
        else:
            evt["status"] = "future"

    # Mark the most recent past event as "latest"
    if last_past_idx is not None:
        events[last_past_idx]["status"] = "latest"

    return data


@router.get("/seasons")
async def list_seasons():
    now = datetime.now(timezone.utc)
    return {"seasons": [s for s in AVAILABLE_SEASONS if s <= now.year]}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    now = time.time()
    cached = _events_cache.get(year)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    data = _build_events(year)
    if data is None:
        # No schedule in storage — fetch from FastF1 and save for next time
        try:
            from services.f1_data import _get_season_events_sync
            import asyncio
            events = await asyncio.to_thread(_get_season_events_sync, year)
            put_json(f"seasons/{year}/schedule.json", {"year": year, "events": events})
            logger.info(f"Generated schedule for {year} on demand ({len(events)} events)")
            data = _build_events(year)
        except Exception as e:
            logger.error(f"Failed to fetch schedule for {year}: {e}")
    if data is None:
        raise HTTPException(status_code=404, detail=f"No schedule data for {year}")

    _events_cache[year] = (data, now)
    return data


@router.get("/sessions/{year}/{round_num}")
async def get_session(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type: R, Q, S, FP1, FP2, FP3, SQ"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/info.json")
    if data is not None:
        return data

    # Fast fallback: build minimal session info from schedule data.
    # This avoids triggering slow FastF1 processing for live sessions
    # that haven't been precomputed yet.
    schedule = get_json(f"seasons/{year}/schedule.json")
    if schedule:
        events = schedule.get("events", [])
        if 0 < round_num <= len(events):
            evt = events[round_num - 1]
            session_type_labels = {
                "R": "Race", "Q": "Qualifying", "S": "Sprint",
                "SQ": "Sprint Qualifying", "FP1": "Practice 1",
                "FP2": "Practice 2", "FP3": "Practice 3",
            }
            return {
                "year": year,
                "round_number": round_num,
                "event_name": evt.get("event_name", f"Round {round_num}"),
                "circuit": evt.get("location", ""),
                "country": evt.get("country", ""),
                "session_type": session_type_labels.get(type, type),
                "drivers": [],
            }

    # On-demand: try to process the session via FastF1 (for replays)
    available = await ensure_session_data(year, round_num, type)
    if available:
        data = get_json(f"sessions/{year}/{round_num}/{type}/info.json")
        if data is not None:
            return data

    raise HTTPException(
        status_code=404,
        detail=f"Session data not available for {year} Round {round_num} ({type}).",
    )


@router.post("/sessions/{year}/{round_num}/reprocess")
async def reprocess_session(year: int, round_num: int, type: str = Query("R")):
    """Re-run processing for a session, overwriting the stored data.

    Auth is enforced by the global /api middleware. Runs in the background;
    poll the status endpoint for completion.
    """
    state = await start_reprocess(year, round_num, type)
    return {"state": state}


@router.get("/sessions/{year}/{round_num}/reprocess/status")
async def reprocess_session_status(year: int, round_num: int, type: str = Query("R")):
    return get_reprocess_status(year, round_num, type)


@router.get("/storage")
async def storage_usage():
    """Stored size of every downloaded session, plus the retention setting."""
    sessions, total = session_index()
    return {
        "total_bytes": total,
        "session_count": len(sessions),
        "sessions": sessions,
        "retention": get_retention(),
    }


@router.delete("/sessions/{year}/{round_num}")
async def delete_session_data(year: int, round_num: int, type: str = Query("R")):
    """Delete one session's stored data. Auth is enforced by the /api middleware."""
    if type not in SESSION_NAME_TO_TYPE.values():
        raise HTTPException(status_code=400, detail=f"Unknown session type: {type}")
    freed = delete_session(year, round_num, type)
    _events_cache.clear()
    return {"deleted": 1, "freed_bytes": freed}


@router.put("/storage/retention")
async def update_retention(
    enabled: bool = Query(...),
    amount: int = Query(...),
    unit: str = Query("months"),
    dry_run: bool = Query(False, description="Report what would be deleted, change nothing"),
):
    """Set the retention policy, applying it immediately.

    Call with dry_run=true first to show the user what saving would remove;
    saving then deletes everything already older than the threshold, and the
    daily sweep keeps it that way.
    """
    try:
        if dry_run:
            return sweep(amount, unit, dry_run=True)

        config = save_retention(enabled, amount, unit)
        if not enabled:
            return {"retention": config, "count": 0, "freed_bytes": 0}

        result = await asyncio.to_thread(sweep, amount, unit)
    except RetentionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _events_cache.clear()
    return {"retention": get_retention(), **result}
