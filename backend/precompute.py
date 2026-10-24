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

    # Write replay chunks for sessions processed before they existed
    # (no FastF1 processing; reads each stored replay.json)
    python precompute.py 2024 2025 2026 --chunks-only

    # Sign in to F1 TV (needed since 15 October 2026), then process
    python precompute.py --sign-in
    python precompute.py 2026 --round 18

Downloads pause --gap seconds (default 60) between sessions so F1's servers
aren't hit with a whole season at once. Prefer a round at a time.
"""

from __future__ import annotations

import argparse
import getpass
import logging
import sys
import os
import time
import traceback

from dotenv import load_dotenv

load_dotenv()

# Ensure backend modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from services import storage
from services import replay_chunks
from services import f1_account
from services.process import process_session_sync
from services.schedule import refresh_schedule
from services.f1_data import (
    _fetch_schedule_sync,
    SESSION_NAME_TO_TYPE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("precompute")


_downloaded_any = False


def process_year(year: int, target_round: int | None = None, target_session: str | None = None,
                 skip_existing: bool = False, gap: float = 60) -> bool:
    """Process all (or specific) sessions for a year. Returns False if F1
    refused the download, so the run should stop."""
    global _downloaded_any
    # Upload schedule
    logger.info(f"Processing schedule for {year}...")
    try:
        events = refresh_schedule(year)
        logger.info(f"Uploaded schedule for {year} ({len(events)} events)")
    except Exception as e:
        logger.error(f"Failed to get schedule for {year}: {e}")
        return True

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
            if skip_existing and storage.exists(f"sessions/{year}/{round_num}/{st}/replay.json"):
                logger.info(f"[{year} R{round_num} {st}] Already exists, skipping")
                continue
            if _downloaded_any and gap > 0:
                logger.info(f"Waiting {gap:g}s before the next download...")
                time.sleep(gap)
            _downloaded_any = True
            try:
                process_session_sync(year, round_num, st, skip_existing=skip_existing)
            except f1_account.F1AccountError as e:
                logger.error(f"{year} R{round_num} {st}: {e} Stopping.")
                return False
            except Exception as e:
                logger.error(f"Failed {year} R{round_num} {st}: {e}")
                traceback.print_exc()
    return True


def sign_in() -> None:
    """Interactive F1 TV sign-in for command-line setups."""
    email = input("F1 account email: ").strip()
    password = getpass.getpass("F1 account password: ")
    remember = input("Keep me signed in (store the password encrypted)? [Y/n] ").strip().lower() != "n"
    try:
        st = f1_account.sign_in_password(email, password, remember)
    except f1_account.F1AccountError as e:
        logger.error(f"Sign-in failed: {e}")
        sys.exit(1)
    logger.info(f"Signed in to F1 TV ({st.get('product') or 'subscription'}); renews automatically: {bool(st.get('renews'))}")


def backfill_chunks(year: int, target_round: int | None = None, target_session: str | None = None):
    """Write replay chunks for stored sessions that only have replay.json."""
    keys = storage.list_keys(f"sessions/{year}/")
    sessions = sorted({
        tuple(k.split("/")[2:4]) for k in keys
        if k.endswith("/replay.json") and len(k.split("/")) == 5
    }, key=lambda rt: (int(rt[0]), rt[1]))
    for rnd, st in sessions:
        rnd = int(rnd)
        if target_round is not None and rnd != target_round:
            continue
        if target_session is not None and st != target_session:
            continue
        if replay_chunks.get_manifest(year, rnd, st):
            logger.info(f"{year} R{rnd} {st}: chunks already exist")
            continue
        try:
            manifest = replay_chunks.build_from_replay_json(year, rnd, st)
            logger.info(f"{year} R{rnd} {st}: {len(manifest['chunks']) if manifest else 0} chunks written")
        except Exception as e:
            logger.error(f"{year} R{rnd} {st}: failed to write chunks: {e}")
            traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="Pre-compute F1 data and upload to storage")
    parser.add_argument("years", type=int, nargs="*", help="Year(s) to process")
    parser.add_argument("--round", type=int, default=None, help="Specific round number")
    parser.add_argument("--session", type=str, default=None, help="Session type (R, Q, S, FP1, FP2, FP3, SQ)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip sessions already in R2")
    parser.add_argument("--chunks-only", action="store_true", help="Only write replay chunks for already-processed sessions")
    parser.add_argument("--sign-in", action="store_true", help="Sign in to your F1 TV account (prompts for email and password)")
    parser.add_argument("--gap", type=float, default=60, help="Seconds to wait between session downloads (default 60)")
    args = parser.parse_args()

    if args.sign_in:
        sign_in()
        if not args.years:
            return
    if not args.years:
        parser.error("give at least one year, or --sign-in")

    if not args.chunks_only and not f1_account.ready():
        logger.error(f1_account.SIGN_IN_NEEDED.replace("under Settings → F1 TV", "with: python precompute.py --sign-in"))
        sys.exit(1)

    for year in args.years:
        if args.chunks_only:
            backfill_chunks(year, target_round=args.round, target_session=args.session)
            continue
        if not process_year(year, target_round=args.round, target_session=args.session,
                            skip_existing=args.skip_existing, gap=args.gap):
            sys.exit(1)

    logger.info("Pre-compute complete.")


if __name__ == "__main__":
    main()
