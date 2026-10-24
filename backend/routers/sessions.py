import asyncio
import logging
import time
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException, Response
from app_config import is_after_public_cutoff, set_cache, validate_session, MIN_YEAR, MAX_YEAR
from services import schedule as schedule_store
from services import availability
from services.storage import get_json, aget_json
from services.process import (
    ensure_session_data,
    start_reprocess,
    get_reprocess_status,
    delete_session,
)
from services.retention import (
    RetentionError,
    get_retention,
    get_sweep_status,
    save_retention,
    session_index,
    start_sweep,
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


def _build_events(year: int, data: dict | None = None) -> dict:
    """Build events response with availability based on session dates."""
    if data is None:
        data = get_json(f"seasons/{year}/schedule.json")
    if data is None:
        return None

    data = deepcopy(data)
    events = data.get("events", [])
    now = datetime.now(timezone.utc)
    last_past_idx = None

    # Which sessions are processed, and their stored size, from the season's
    # small availability index rather than a listing of every stored file.
    try:
        stored = availability.get(year)
    except Exception as e:
        logger.warning(f"Could not read availability for {year}: {e}")
        stored = {}

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

            code = SESSION_NAME_TO_TYPE.get(session.get("name", ""))
            if rnd is not None and is_after_public_cutoff(year, rnd):
                # Behind F1 TV on this public site, even if the shared bucket has it.
                session["precomputed"] = False
                session["size_bytes"] = 0
                session["paywalled"] = True
            elif code and rnd is not None:
                size = stored.get(f"{rnd}/{code}")
                session["precomputed"] = size is not None
                session["size_bytes"] = size or 0
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


_event_names: dict[tuple[int, int], str] = {}


async def event_name(year: int, round_num: int) -> str | None:
    """Event name for a round from the stored schedule, e.g. "Singapore Grand Prix"."""
    if (year, round_num) in _event_names:
        return _event_names[(year, round_num)]
    try:
        schedule = await aget_json(f"seasons/{year}/schedule.json")
    except Exception:
        return None
    for evt in (schedule or {}).get("events", []):
        if evt.get("round_number") == round_num and evt.get("event_name"):
            _event_names[(year, round_num)] = evt["event_name"]
            return evt["event_name"]
    return None


@router.get("/seasons")
async def list_seasons():
    now = datetime.now(timezone.utc)
    return {"seasons": [s for s in AVAILABLE_SEASONS if s <= now.year]}


@router.get("/seasons/{year}/events")
async def list_events(year: int, response: Response):
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise HTTPException(status_code=400, detail=f"Unsupported year: {year}")
    set_cache(response, 60)
    now = time.time()
    cached = _events_cache.get(year)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    stored = await aget_json(f"seasons/{year}/schedule.json")
    if stored is None:
        # No schedule in storage — fetch from FastF1 and save for next time
        try:
            await asyncio.to_thread(schedule_store.refresh_schedule, year)
            stored = await aget_json(f"seasons/{year}/schedule.json")
        except Exception as e:
            logger.error(f"Failed to fetch schedule for {year}: {e}")
    elif schedule_store.is_stale(stored):
        # Serve what we have now; the refreshed calendar shows on the next load.
        schedule_store.refresh_in_background(year, on_done=lambda: _events_cache.pop(year, None))

    data = await asyncio.to_thread(_build_events, year, stored) if stored else None
    if data is None:
        raise HTTPException(status_code=404, detail=f"No schedule data for {year}")

    _events_cache[year] = (data, now)
    return data


@router.get("/sessions/{year}/{round_num}")
async def get_session(
    year: int,
    round_num: int,
    response: Response,
    type: str = Query("R", description="Session type: R, Q, S, FP1, FP2, FP3, SQ"),
):
    validate_session(year, round_num, type)
    data = await aget_json(f"sessions/{year}/{round_num}/{type}/info.json")
    if data is not None:
        set_cache(response, 300)
        return data

    # Fast fallback: build minimal session info from schedule data.
    # This avoids triggering slow FastF1 processing for live sessions
    # that haven't been precomputed yet.
    schedule = await aget_json(f"seasons/{year}/schedule.json")
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
        data = await aget_json(f"sessions/{year}/{round_num}/{type}/info.json")
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
    validate_session(year, round_num, type)
    state = await start_reprocess(year, round_num, type)
    return {"state": state}


@router.get("/sessions/{year}/{round_num}/reprocess/status")
async def reprocess_session_status(year: int, round_num: int, type: str = Query("R")):
    return get_reprocess_status(year, round_num, type)


@router.get("/storage")
async def storage_usage():
    """Stored size of every downloaded session, plus the retention setting."""
    sessions, total = await asyncio.to_thread(session_index)
    return {
        "total_bytes": total,
        "session_count": len(sessions),
        "sessions": sessions,
        "retention": get_retention(),
    }


@router.delete("/sessions/{year}/{round_num}")
async def delete_session_data(year: int, round_num: int, type: str = Query("R")):
    """Delete one session's stored data. Auth is enforced by the /api middleware."""
    validate_session(year, round_num, type)
    freed = await asyncio.to_thread(delete_session, year, round_num, type)
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
            return {"retention": config, "started": False}

        # Deleting a large backlog takes a while, so run it in the background
        # and let the client poll for progress rather than holding the request.
        status = await start_sweep(amount, unit)
    except RetentionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _events_cache.clear()
    return {"retention": config, "started": True, "status": status}


@router.get("/storage/retention/status")
async def retention_status():
    """Progress of the running or most recent sweep."""
    return get_sweep_status()
