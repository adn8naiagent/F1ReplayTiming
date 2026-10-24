"""Mini-sectors: F1's per-loop colours within each sector (qualifying,
sprint qualifying and practice).

The timing feed splits each sector into "segments" (timing loops, roughly
every 200 m) and colours each one as a car crosses it: 2048 yellow, 2049
green (personal best), 2051 purple (overall best), 2064 pit lane, 0 cleared.
It gives colours by index only, so where each mini-sector ends on track is
worked out from where the cars were when its colour changed.

minisectors.json:
    {"counts": [8, 8, 8],
     "ends": [0.03, 0.05, ...],        # each mini-sector's end, 0–1 along the lap
     "drivers": {"VER": [[t, sector, index, status], ...]}}
t is replay seconds. [t, -1, -1, 0] clears all of a driver's mini-sectors
(F1 does this at the start of every lap), which keeps the file small.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

PIT_LANE = 2064
SESSION_TYPES = ("Q", "SQ", "FP1", "FP2", "FP3")


def _stream_secs(ts: str) -> float:
    h, m, s = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def _items(value: Any):
    """Sectors and Segments come as a list in full updates and a dict keyed
    by index in partial ones."""
    if isinstance(value, dict):
        return value.items()
    if isinstance(value, list):
        return enumerate(value)
    return ()


def parse_stream(pages: list) -> tuple[list[int], dict[str, list[tuple[float, int, int, int]]]]:
    """Mini-sector counts per sector, and each car's status changes
    (stream seconds, sector, index, status) by racing number."""
    counts = [0, 0, 0]
    events: dict[str, list[tuple[float, int, int, int]]] = defaultdict(list)
    for entry in pages or []:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            continue
        ts, content = entry
        lines = content.get("Lines") if isinstance(content, dict) else None
        if not isinstance(lines, dict):
            continue
        t = _stream_secs(ts)
        for number, line in lines.items():
            if not isinstance(line, dict):
                continue
            for si, sector in _items(line.get("Sectors")):
                if not isinstance(sector, dict):
                    continue
                for gi, seg in _items(sector.get("Segments")):
                    if not isinstance(seg, dict) or "Status" not in seg:
                        continue
                    s, g = int(si), int(gi)
                    if s > 2:
                        continue
                    counts[s] = max(counts[s], g + 1)
                    events[str(number)].append((t, s, g, int(seg["Status"])))
    return counts, events


def _compact(events: list[tuple[float, int, int, int]], total: int) -> list[tuple[float, int, int, int]]:
    """Collapse a lap-start clear (every mini-sector set to 0 at once) into
    one [t, -1, -1, 0], placed before anything set at the same moment."""
    by_time: dict[float, list[tuple[float, int, int, int]]] = defaultdict(list)
    for e in events:
        by_time[e[0]].append(e)
    out = []
    for t in sorted(by_time):
        group = by_time[t]
        zeros = [e for e in group if e[3] == 0]
        rest = [e for e in group if e[3] != 0]
        if total and len(zeros) >= total - 2:
            out.append((t, -1, -1, 0))
            out.extend(rest)
        else:
            out.extend(zeros + rest)
    return out


def outline_fractions(track_points: list[dict]) -> np.ndarray:
    """Each outline point's position along the lap, 0–1 by distance (same as
    the frontend's lapFractions)."""
    xy = np.array([[p["x"], p["y"]] for p in track_points], dtype=np.float64)
    seg = np.hypot(*np.diff(xy, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    return cum / (cum[-1] or 1.0)


def _nearest_fraction(xy: np.ndarray, outline: np.ndarray, frac: np.ndarray) -> np.ndarray:
    out = np.empty(len(xy))
    for i in range(0, len(xy), 2000):
        chunk = xy[i:i + 2000]
        d = ((chunk[:, None, :] - outline[None, :, :]) ** 2).sum(axis=2)
        out[i:i + 2000] = frac[d.argmin(axis=1)]
    return out


def _circular_median(values: np.ndarray) -> float:
    """Median of fractions on a loop, so values either side of the line
    (0.99, 0.01) don't average to 0.5."""
    angles = values * 2 * np.pi
    ref = np.arctan2(np.sin(angles).mean(), np.cos(angles).mean()) / (2 * np.pi) % 1.0
    shifted = ref + ((values - ref + 0.5) % 1.0 - 0.5)
    return float(np.median(shifted) % 1.0)


def _positions_from_frames(frames: list[dict]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Each driver's (times, x/y) from the replay frames."""
    times: dict[str, list[float]] = defaultdict(list)
    xy: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for f in frames:
        t = f.get("timestamp")
        for d in f.get("drivers") or []:
            if d.get("in_pit") or d.get("x") is None:
                continue
            times[d["abbr"]].append(t)
            xy[d["abbr"]].append((d["x"], d["y"]))
    return {a: (np.array(times[a]), np.array(xy[a])) for a in times}


def build(
    pages: list,
    offset_secs: float,
    frames: list[dict],
    track_points: list[dict],
    number_to_abbr: dict[str, str],
) -> dict | None:
    """minisectors.json for a session. offset_secs converts stream time to
    replay time, the same offset laps.json uses."""
    counts, raw = parse_stream(pages)
    total = sum(counts)
    if not total or not track_points:
        return None

    outline = np.array([[p["x"], p["y"]] for p in track_points], dtype=np.float64)
    frac = outline_fractions(track_points)
    positions = _positions_from_frames(frames)

    # Where each mini-sector ends: where cars were as it changed colour.
    samples: dict[tuple[int, int], list[np.ndarray]] = defaultdict(list)
    drivers: dict[str, list[list]] = {}
    for number, events in raw.items():
        abbr = number_to_abbr.get(number)
        if not abbr:
            continue
        replay_events = [(round(t - offset_secs, 1), s, g, st) for t, s, g, st in events]
        drivers[abbr] = [list(e) for e in _compact(replay_events, total)]

        if abbr not in positions:
            continue
        ptimes, pxy = positions[abbr]
        if len(ptimes) < 2:
            continue
        timed = [(t, s, g) for t, s, g, st in replay_events if st not in (0, PIT_LANE)]
        if not timed:
            continue
        ts = np.array([e[0] for e in timed])
        idx = np.clip(np.searchsorted(ptimes, ts), 1, len(ptimes) - 1)
        # Nearest frame, and only if it's close (cars missing from frames)
        prev_closer = np.abs(ptimes[idx - 1] - ts) < np.abs(ptimes[idx] - ts)
        idx = np.where(prev_closer, idx - 1, idx)
        ok = np.abs(ptimes[idx] - ts) <= 1.0
        if not ok.any():
            continue
        fr = _nearest_fraction(pxy[idx[ok]], outline, frac)
        for (t, s, g), f in zip([e for e, k in zip(timed, ok) if k], fr):
            samples[(s, g)].append(f)

    ends = []
    for s in range(3):
        for g in range(counts[s]):
            vals = samples.get((s, g))
            ends.append(round(_circular_median(np.array(vals)), 4) if vals else None)
    if any(e is None for e in ends):
        logger.warning(f"Mini-sectors: couldn't place {sum(e is None for e in ends)} of {total} on track")
        return None
    # The last mini-sector ends at the line
    ends[-1] = 1.0
    return {"counts": counts, "ends": ends, "drivers": drivers}
