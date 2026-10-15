"""Download .jsonStream files for a past session into backend/data/live_test/.

The live router's test replayer reads these files to simulate a live SignalR
stream without a real session running. See services/live_test_replayer.py.

Usage:
    python backend/scripts/download_test_session.py --year 2024 --round 1 --session R
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import fastf1

BASE = "https://livetiming.formula1.com"

# Mirror of live_signalr._TOPICS — files we expect to exist on the static API.
STREAM_TOPICS = [
    "TimingData",
    "TimingAppData",
    "TimingStats",
    "DriverList",
    "RaceControlMessages",
    "TrackStatus",
    "WeatherData",
    "LapCount",
    "ExtrapolatedClock",
    "SessionInfo",
    "SessionStatus",
    "SessionData",
    "Position.z",
    "CarData.z",
]

# Initial state .json files the replayer loads at t=-1 (see _SAFE_INIT_TOPICS).
INIT_TOPICS = [
    "DriverList",
    "TimingAppData",
    "WeatherData",
    "TrackStatus",
    "SessionInfo",
]


def _fetch(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "f1timing-test-downloader/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 0
        raise
    dest.write_bytes(data)
    return len(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--session", default="R", help="Session code: R, Q, S, SQ, FP1, FP2, FP3")
    args = parser.parse_args()

    session = fastf1.get_session(args.year, args.round, args.session)
    api_path = session.api_path  # e.g. /static/2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/
    base_url = BASE + api_path

    out_dir = (
        Path(__file__).resolve().parent.parent
        / "data"
        / "live_test"
        / f"{args.year}_{args.round}_{args.session}"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading from {base_url}")
    print(f"Saving to        {out_dir}")
    print()

    total_bytes = 0
    skipped = []

    for topic in STREAM_TOPICS:
        url = f"{base_url}{topic}.jsonStream"
        dest = out_dir / f"{topic}.jsonStream"
        try:
            n = _fetch(url, dest)
        except Exception as e:
            print(f"  {topic:<22} ERROR  {e}")
            continue
        if n == 0:
            skipped.append(topic + ".jsonStream")
            print(f"  {topic:<22} 404")
        else:
            total_bytes += n
            print(f"  {topic:<22} {n / 1024:>10.1f} KB  stream")
        time.sleep(0.1)

    for topic in INIT_TOPICS:
        url = f"{base_url}{topic}.json"
        dest = out_dir / f"{topic}.json"
        try:
            n = _fetch(url, dest)
        except Exception as e:
            print(f"  {topic:<22} ERROR  {e}")
            continue
        if n == 0:
            skipped.append(topic + ".json")
            print(f"  {topic:<22} 404")
        else:
            total_bytes += n
            print(f"  {topic:<22} {n / 1024:>10.1f} KB  init")
        time.sleep(0.1)

    print()
    print(f"Total: {total_bytes / 1024 / 1024:.2f} MB across {len(STREAM_TOPICS) + len(INIT_TOPICS) - len(skipped)} files")
    if skipped:
        print(f"Skipped (404): {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
