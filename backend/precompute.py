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
from services.process import process_session_sync
from services.f1_data import (
    _fetch_schedule_sync,
    _get_season_events_sync,
    SESSION_NAME_TO_TYPE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("precompute")


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
                process_session_sync(year, round_num, st, skip_existing=skip_existing)
            except Exception as e:
                logger.error(f"Failed {year} R{round_num} {st}: {e}")
                traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="Pre-compute F1 data and upload to storage")
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
