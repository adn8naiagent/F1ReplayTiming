#!/usr/bin/env python3
"""Pre-compute F1 session data and store it.

Uses local filesystem by default, or Cloudflare R2 if STORAGE_MODE=r2.

Usage:
    # Process all sessions for a year
    python precompute.py 2024

    # Process a specific round
    python precompute.py 2024 --round 1

    # Process a specific session type
    python precompute.py 2024 --round 1 --session R

    # Skip already-processed sessions
    python precompute.py 2024 --skip-existing

    # Process multiple years
    python precompute.py 2024 2025
"""

from __future__ import annotations

import argparse
import logging
import sys
import os
import traceback

from dotenv import load_dotenv

load_dotenv()

# Ensure backend modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from services import storage
from services.f1_data import (
    _fetch_schedule_sync,
    _get_season_events_sync,
    _get_track_data_sync,
    _get_lap_data_sync,
    _get_race_results_sync,
    _get_driver_positions_by_time_sync,
    _get_session_info_sync,
    _get_driver_telemetry_sync,
    SESSION_NAME_TO_TYPE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("precompute")


def r2_path(year: int, round_num: int, session_type: str, filename: str) -> str:
    return f"sessions/{year}/{round_num}/{session_type}/{filename}"


def process_session(year: int, round_num: int, session_type: str, skip_existing: bool = False) -> bool:
    """Process and upload all data for a single session. Returns True if successful."""
    prefix = f"{year} R{round_num} {session_type}"
    base = f"sessions/{year}/{round_num}/{session_type}"

    if skip_existing and storage.exists(f"{base}/replay.json"):
        logger.info(f"[{prefix}] Already exists, skipping")
        return True

    logger.info(f"[{prefix}] Processing...")

    # Session info
    try:
        info = _get_session_info_sync(year, round_num, session_type)
        storage.put_json(f"{base}/info.json", info)
    except Exception as e:
        logger.error(f"[{prefix}] Failed to get session info: {e}")
        return False

    # Track data
    try:
        track = _get_track_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/track.json", track)
    except Exception as e:
        logger.warning(f"[{prefix}] No track data: {e}")

    # Lap data
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

    # Replay frames (the big one)
    try:
        frames = _get_driver_positions_by_time_sync(year, round_num, session_type)
        storage.put_json(f"{base}/replay.json", frames)
        logger.info(f"[{prefix}] Uploaded {len(frames)} replay frames")
    except Exception as e:
        logger.warning(f"[{prefix}] No replay data: {e}")

    # Telemetry per driver (batched: one file per driver, all laps)
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
                    tel = _get_driver_telemetry_sync(year, round_num, session_type, abbr, lap_num)
                    if tel:
                        drv_telemetry[str(lap_num)] = tel
                except Exception:
                    continue
            if drv_telemetry:
                storage.put_json(f"{base}/telemetry/{abbr}.json", drv_telemetry)
        logger.info(f"[{prefix}] Uploaded telemetry for {len(drivers)} drivers")
    except Exception as e:
        logger.warning(f"[{prefix}] Telemetry upload issue: {e}")

    logger.info(f"[{prefix}] Done")
    return True


def process_year(year: int, target_round: int | None = None, target_session: str | None = None, skip_existing: bool = False):
    """Process all (or specific) sessions for a year."""
    # Upload schedule
    logger.info(f"Processing schedule for {year}...")
    try:
        events = _get_season_events_sync(year)
        storage.put_json(f"seasons/{year}/schedule.json", {"year": year, "events": events})
        logger.info(f"Uploaded schedule for {year} ({len(events)} events)")
    except Exception as e:
        logger.error(f"Failed to get schedule for {year}: {e}")
        return

    raw_events = _fetch_schedule_sync(year)

    for event in raw_events:
        round_num = event["round_number"]
        if target_round is not None and round_num != target_round:
            continue

        # Determine which session types to process
        session_types = []
        for s in event["sessions_raw"]:
            st = SESSION_NAME_TO_TYPE.get(s["name"])
            if st:
                if target_session is not None and st != target_session:
                    continue
                session_types.append(st)

        for st in session_types:
            try:
                process_session(year, round_num, st, skip_existing)
            except Exception as e:
                logger.error(f"Failed {year} R{round_num} {st}: {e}")
                traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="Pre-compute F1 data and upload to R2")
    parser.add_argument("years", type=int, nargs="+", help="Year(s) to process")
    parser.add_argument("--round", type=int, default=None, help="Specific round number")
    parser.add_argument("--session", type=str, default=None, help="Session type (R, Q, S, FP1, FP2, FP3, SQ)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip sessions already in R2")
    args = parser.parse_args()

    for year in args.years:
        process_year(year, target_round=args.round, target_session=args.session, skip_existing=args.skip_existing)

    logger.info("Pre-compute complete.")


if __name__ == "__main__":
    main()
