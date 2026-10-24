"""On-demand session processing.

Shared by both the CLI precompute script and the backend's on-demand processing.
Uses locks to prevent duplicate processing of the same session.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import traceback
from datetime import datetime, timezone

from app_config import is_public_mode
from services import storage
from services import replay_chunks
from services import availability
from services import f1_account
from services.f1_data import (
    release_sessions,
    _get_session_info_sync,
    _get_track_data_sync,
    _get_lap_data_sync,
    _get_race_results_sync,
    _get_driver_positions_by_time_sync,
    _get_driver_telemetry_sync,
    _get_team_radio_sync,
)

logger = logging.getLogger(__name__)

# Locks to prevent duplicate processing of the same session
_locks: dict[str, asyncio.Lock] = {}

# Sessions being processed per weekend, so loaded FastF1 data for a weekend is
# only released once nothing from it is still in progress.
_active_rounds: dict[tuple[int, int], int] = {}
_active_lock = threading.Lock()

# State of user-triggered reprocess jobs: key -> {"state": ..., "message": ...}
# state is "running" | "done" | "error"
_reprocess_status: dict[str, dict] = {}

# Written when a user deletes a session. auto_precompute skips sessions carrying
# one, so an explicit delete isn't undone by the background downloader; any
# successful reprocess clears it.
TOMBSTONE = "deleted.json"


def get_reprocess_status(year: int, round_num: int, session_type: str) -> dict:
    """Return the current reprocess state + latest progress message for a session."""
    return _reprocess_status.get(
        f"{year}_{round_num}_{session_type}", {"state": "idle", "message": ""}
    )


async def start_reprocess(year: int, round_num: int, session_type: str) -> str:
    """Kick off a background reprocess (overwrite) for a session.

    Returns the resulting state immediately ("running", or "busy" if one is
    already in flight for this session). Poll get_reprocess_status for progress.
    """
    key = f"{year}_{round_num}_{session_type}"
    if _reprocess_status.get(key, {}).get("state") == "running":
        return "busy"
    _reprocess_status[key] = {"state": "running", "message": "Starting…"}

    def on_status(msg: str):
        cur = _reprocess_status.get(key)
        if cur is not None:
            cur["message"] = msg

    async def _run():
        try:
            # skip_existing defaults False, so this overwrites the stored session.
            ok = await asyncio.to_thread(
                process_session_sync, year, round_num, session_type, False, on_status
            )
            _reprocess_status[key] = {
                "state": "done" if ok else "error",
                "message": "Reprocess complete" if ok else "Reprocess failed",
            }
        except Exception as e:
            logger.error(f"Reprocess failed for {key}: {e}")
            traceback.print_exc()
            _reprocess_status[key] = {"state": "error", "message": str(e)[:200] or "Reprocess failed"}

    asyncio.create_task(_run())
    return "running"


def process_session_sync(
    year: int,
    round_num: int,
    session_type: str,
    skip_existing: bool = False,
    on_status: callable = None,
) -> bool:
    """Process and upload all data for a single session. Returns True if successful.

    on_status: optional callback(message: str) called with progress updates.
    """
    round_key = (year, round_num)
    with _active_lock:
        _active_rounds[round_key] = _active_rounds.get(round_key, 0) + 1
    try:
        return _process_session_sync(year, round_num, session_type, skip_existing, on_status)
    finally:
        with _active_lock:
            _active_rounds[round_key] -= 1
            last = _active_rounds[round_key] == 0
            if last:
                del _active_rounds[round_key]
        # FastF1 sessions hold every lap's telemetry. Once nothing from this
        # weekend is being processed, free them; the data is in storage now.
        if last:
            release_sessions(year, round_num)


def _process_session_sync(
    year: int,
    round_num: int,
    session_type: str,
    skip_existing: bool,
    on_status: callable,
) -> bool:
    prefix = f"{year} R{round_num} {session_type}"
    base = f"sessions/{year}/{round_num}/{session_type}"

    if skip_existing and storage.exists(f"{base}/replay.json"):
        logger.info(f"[{prefix}] Already exists, skipping")
        return True

    def status(msg: str):
        logger.info(f"[{prefix}] {msg}")
        if on_status:
            on_status(msg)

    # Stop before writing anything if F1 would refuse the download.
    f1_account.require_ready()

    status("Loading session data from F1 API...")

    # Session info
    try:
        info = _get_session_info_sync(year, round_num, session_type)
        storage.put_json(f"{base}/info.json", info)
    except f1_account.F1AccountError:
        raise
    except Exception as e:
        logger.error(f"[{prefix}] Failed to get session info: {e}")
        return False

    status("Processing track data...")

    # Track data
    try:
        track = _get_track_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/track.json", track)
    except Exception as e:
        logger.warning(f"[{prefix}] No track data: {e}")

    status("Processing lap data...")

    # Lap data
    laps = None
    try:
        laps = _get_lap_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/laps.json", laps)
    except Exception as e:
        logger.warning(f"[{prefix}] No lap data: {e}")

    # Results
    try:
        results = _get_race_results_sync(year, round_num, session_type)
        storage.put_json(f"{base}/results.json", results)
    except Exception as e:
        logger.warning(f"[{prefix}] No results: {e}")

    status("Building replay frames (this may take a minute)...")

    # Replay frames (the big one)
    try:
        frames = _get_driver_positions_by_time_sync(year, round_num, session_type)
        storage.put_json(f"{base}/replay.json", frames)
        logger.info(f"[{prefix}] Uploaded {len(frames)} replay frames")
        status("Writing replay files...")
        replay_chunks.write_chunks(year, round_num, session_type, frames)
        del frames
    except Exception as e:
        logger.warning(f"[{prefix}] No replay data: {e}")

    status("Captioning team radio...")

    # Team radio, timed against the replay frames
    try:
        clips = _get_team_radio_sync(
            year, round_num, session_type,
            on_progress=lambda i, n: status(f"Captioning team radio ({i}/{n})..."),
        )
        if clips is not None:
            storage.put_json(f"{base}/team_radio.json", {"clips": clips})
            logger.info(f"[{prefix}] Saved {len(clips)} team radio clips")
    except f1_account.F1AccountError:
        raise
    except Exception as e:
        logger.warning(f"[{prefix}] No team radio: {e}")

    status("Processing telemetry...")

    # Telemetry per driver
    try:
        drivers = info.get("drivers", [])
        total_laps_set = set()
        if laps:
            for lap in laps:
                total_laps_set.add(lap["lap_number"])

        for drv in drivers:
            abbr = drv["abbreviation"]
            drv_telemetry = {}
            for lap_num in sorted(total_laps_set):
                try:
                    tel = _get_driver_telemetry_sync(
                        year, round_num, session_type, abbr, lap_num
                    )
                    if tel:
                        drv_telemetry[str(lap_num)] = tel
                except Exception:
                    continue
            if drv_telemetry:
                storage.put_json(f"{base}/telemetry/{abbr}.json", drv_telemetry)
        logger.info(f"[{prefix}] Uploaded telemetry for {len(drivers)} drivers")
    except Exception as e:
        logger.warning(f"[{prefix}] Telemetry upload issue: {e}")

    # Session is back — drop any delete tombstone so auto-precompute resumes.
    try:
        storage.delete(f"{base}/{TOMBSTONE}")
    except Exception:
        pass

    availability.refresh_session(year, round_num, session_type)

    # The WebSocket player may hold the old frames in memory.
    try:
        from routers.replay import evict_cached_session
        evict_cached_session(year, round_num, session_type)
    except Exception:
        pass

    # Invalidate the cached events listing so the picker shows the downloaded
    # marker straight away, rather than after the 5 minute cache expires.
    try:
        from routers.sessions import _events_cache
        _events_cache.clear()
    except Exception:
        pass

    status("Processing complete")
    logger.info(f"[{prefix}] Done")
    return True


async def ensure_session_data(
    year: int,
    round_num: int,
    session_type: str,
    on_status: callable = None,
) -> bool:
    """Ensure session data exists, processing on-demand if needed.

    Uses per-session locks so concurrent requests wait rather than duplicate work.
    on_status: optional async callback(message: str) for progress updates.
    """
    base = f"sessions/{year}/{round_num}/{session_type}"

    # Fast path: data already exists
    if storage.exists(f"{base}/replay.json"):
        return True

    # Public sites only show sessions that are already processed.
    if is_public_mode():
        return False

    # Get or create lock for this session
    key = f"{year}_{round_num}_{session_type}"
    if key not in _locks:
        _locks[key] = asyncio.Lock()

    async with _locks[key]:
        # Double-check after acquiring lock (another request may have finished)
        if storage.exists(f"{base}/replay.json"):
            return True

        # Wrap sync callback for async on_status
        status_messages = []

        def sync_status(msg: str):
            status_messages.append(msg)

        # Run processing in a thread
        try:
            success = await asyncio.to_thread(
                process_session_sync,
                year,
                round_num,
                session_type,
                on_status=sync_status,
            )
            return success
        except Exception as e:
            logger.error(f"On-demand processing failed for {key}: {e}")
            traceback.print_exc()
            return False


async def ensure_session_data_ws(
    year: int,
    round_num: int,
    session_type: str,
    send_status,
) -> bool:
    """Like ensure_session_data but sends WebSocket status updates during processing."""
    base = f"sessions/{year}/{round_num}/{session_type}"

    if storage.exists(f"{base}/replay.json"):
        return True

    if is_public_mode():
        return False

    key = f"{year}_{round_num}_{session_type}"
    if key not in _locks:
        _locks[key] = asyncio.Lock()

    # If another request is already processing, just wait
    if _locks[key].locked():
        await send_status("Waiting for session data (another request is processing)...")
        async with _locks[key]:
            return storage.exists(f"{base}/replay.json")

    async with _locks[key]:
        if storage.exists(f"{base}/replay.json"):
            return True

        await send_status("Session data not found — processing on demand...")

        # Use a queue to bridge sync callbacks to async WebSocket sends
        status_queue: asyncio.Queue = asyncio.Queue()

        def sync_status(msg: str):
            status_queue.put_nowait(msg)

        # Run processing in background thread
        loop = asyncio.get_event_loop()
        process_task = loop.run_in_executor(
            None,
            process_session_sync,
            year,
            round_num,
            session_type,
            False,
            sync_status,
        )

        # Forward status messages while processing
        while not process_task.done():
            try:
                msg = await asyncio.wait_for(status_queue.get(), timeout=1.0)
                await send_status(msg)
            except asyncio.TimeoutError:
                pass

        # Drain remaining messages
        while not status_queue.empty():
            msg = status_queue.get_nowait()
            await send_status(msg)

        try:
            success = process_task.result()
            return success
        except f1_account.F1AccountError as e:
            await send_status(str(e))
            return False
        except Exception as e:
            logger.error(f"On-demand processing failed for {key}: {e}")
            return False


def is_deleted(year: int, round_num: int, session_type: str) -> bool:
    """True if the user explicitly deleted this session's data."""
    base = f"sessions/{year}/{round_num}/{session_type}"
    return storage.exists(f"{base}/{TOMBSTONE}")


def delete_session(year: int, round_num: int, session_type: str) -> int:
    """Delete a session's stored data. Returns the number of bytes freed.

    replay.json is removed first, because every availability check in the app
    keys off it. If the delete is interrupted the session then reads as "not
    downloaded" and reprocesses cleanly, rather than being left present but
    incomplete — the failure mode people hit deleting these files by hand.
    """
    base = f"sessions/{year}/{round_num}/{session_type}"

    freed = storage.delete(f"{base}/replay.json")
    freed += storage.delete_prefix(base)

    storage.put_json(
        f"{base}/{TOMBSTONE}",
        {"deleted_at": datetime.now(timezone.utc).isoformat()},
    )
    availability.refresh_session(year, round_num, session_type)

    # Frames stay resident until the cache evicts them, so drop them now —
    # otherwise deleting from disk frees no memory for up to 5 minutes.
    try:
        from routers.replay import evict_cached_session
        evict_cached_session(year, round_num, session_type)
    except Exception as e:
        logger.warning(f"Could not evict replay cache for {base}: {e}")

    logger.info(f"Deleted {base} — freed {freed} bytes")
    return freed


# ---------------------------------------------------------------------------
# Preparing a session for the static replay player
# ---------------------------------------------------------------------------

# key -> {"state": "running" | "done" | "error" | "unavailable", "message": str}
_prepare_status: dict[str, dict] = {}


def get_prepare_status(year: int, round_num: int, session_type: str) -> dict:
    return _prepare_status.get(
        f"{year}_{round_num}_{session_type}", {"state": "idle", "message": ""}
    )


def clear_prepare_status(year: int, round_num: int, session_type: str) -> None:
    _prepare_status.pop(f"{year}_{round_num}_{session_type}", None)


def start_prepare(year: int, round_num: int, session_type: str) -> dict:
    """Make sure replay chunks exist, in the background. Poll get_prepare_status.

    Sessions processed before chunks existed are converted from replay.json;
    unprocessed sessions are processed from FastF1 (not in public mode).
    """
    key = f"{year}_{round_num}_{session_type}"
    current = _prepare_status.get(key)
    if current and current["state"] == "running":
        return current
    _prepare_status[key] = {"state": "running", "message": "Loading session data..."}

    def set_message(msg: str):
        cur = _prepare_status.get(key)
        if cur is not None and cur["state"] == "running":
            cur["message"] = msg

    def run_sync() -> dict:
        base = f"sessions/{year}/{round_num}/{session_type}"
        if replay_chunks.get_manifest(year, round_num, session_type):
            return {"state": "done", "message": ""}
        if storage.exists(f"{base}/replay.json"):
            set_message("Preparing replay files (first view only)...")
            ok = replay_chunks.build_from_replay_json(year, round_num, session_type)
            return {"state": "done" if ok else "error", "message": "" if ok else "No replay data"}
        if is_public_mode():
            return {"state": "unavailable", "message": "This session isn't available yet."}
        set_message("Session data not found — processing on demand...")
        try:
            ok = process_session_sync(year, round_num, session_type, False, set_message)
        except f1_account.F1AccountError as e:
            return {"state": "error", "message": str(e)}
        if ok and replay_chunks.get_manifest(year, round_num, session_type):
            return {"state": "done", "message": ""}
        return {"state": "error", "message": "Failed to load session data. The session may not be available yet."}

    async def run():
        if key not in _locks:
            _locks[key] = asyncio.Lock()
        async with _locks[key]:
            try:
                _prepare_status[key] = await asyncio.to_thread(run_sync)
            except Exception as e:
                logger.error(f"Preparing replay for {key} failed: {e}")
                traceback.print_exc()
                _prepare_status[key] = {"state": "error", "message": "Failed to prepare replay"}

    asyncio.create_task(run())
    return _prepare_status[key]
