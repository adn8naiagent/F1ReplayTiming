#!/usr/bin/env python3
"""Check that replay chunks match replay.json frame for frame.

Rebuilds what the WebSocket player sends (cleaned frames with pit predictions)
from replay.json and compares it with the frames read back from the chunks.

Usage:
    python scripts/check_replay_chunks.py 2026              # every session in a season
    python scripts/check_replay_chunks.py 2026 --round 11 --session R
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from services import replay_chunks, storage  # noqa: E402


def _normalise(frames: list[dict]) -> str:
    return json.dumps(frames, sort_keys=True, separators=(",", ":"))


def check(year: int, rnd: int, st: str) -> bool:
    label = f"{year} R{rnd} {st}"
    manifest = replay_chunks.get_manifest(year, rnd, st)
    if not manifest:
        print(f"SKIP  {label}: no chunks")
        return True
    frames = storage.get_json(f"sessions/{year}/{rnd}/{st}/replay.json")
    if not frames:
        print(f"SKIP  {label}: no replay.json")
        return True

    expected = replay_chunks.prepare_frames(frames, replay_chunks.pit_loss_for(year, rnd, st))
    actual: list[dict] = []
    for c in manifest["chunks"]:
        chunk = storage.get_json(replay_chunks.chunk_path(year, rnd, st, manifest["version"], c["index"]))
        if chunk is None:
            print(f"FAIL  {label}: chunk {c['index']} missing")
            return False
        if len(chunk) != c["frames"]:
            print(f"FAIL  {label}: chunk {c['index']} has {len(chunk)} frames, manifest says {c['frames']}")
            return False
        actual.extend(chunk)

    problems = []
    if len(actual) != len(expected):
        problems.append(f"{len(actual)} frames in chunks, {len(expected)} in replay.json")
    if manifest["total_frames"] != len(expected):
        problems.append(f"manifest total_frames {manifest['total_frames']} != {len(expected)}")
    if manifest["total_time"] != expected[-1]["timestamp"]:
        problems.append("manifest total_time doesn't match the last frame")
    if not problems and _normalise(actual) != _normalise(expected):
        for i, (a, e) in enumerate(zip(actual, expected)):
            if _normalise([a]) != _normalise([e]):
                problems.append(f"first difference at frame {i} (t={e['timestamp']})")
                break

    if problems:
        print(f"FAIL  {label}: " + "; ".join(problems))
        return False
    print(f"OK    {label}: {len(actual)} frames in {len(manifest['chunks'])} chunks match")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("years", type=int, nargs="+")
    parser.add_argument("--round", type=int, default=None)
    parser.add_argument("--session", type=str, default=None)
    args = parser.parse_args()

    ok = True
    for year in args.years:
        sessions = sorted({
            (int(k.split("/")[2]), k.split("/")[3])
            for k in storage.list_keys(f"sessions/{year}/")
            if k.endswith("/replay.json") and len(k.split("/")) == 5
        })
        for rnd, st in sessions:
            if args.round is not None and rnd != args.round:
                continue
            if args.session is not None and st != args.session:
                continue
            ok = check(year, rnd, st) and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
