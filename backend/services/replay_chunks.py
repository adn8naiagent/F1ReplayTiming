"""Static replay files: a session's frames split into small chunks plus a manifest.

The browser player fetches the manifest, then only the chunks it needs, so a
replay costs the server nothing per viewer. Layout under each session:

    replay/manifest.json             points at the current version
    replay/<version>/chunk-0000.json frames for [0s, 60s), and so on

Chunks live under a versioned folder so a reprocess never changes the content
behind a URL a cache has already stored.
"""

from __future__ import annotations

import gc
import logging
import math
import re
import threading
import time

from services import storage

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 60
FORMAT = 1

# Building chunks from an existing replay.json loads the whole session into
# memory, so only ever do one at a time.
_build_lock = threading.Lock()


def replay_prefix(year: int, round_num: int, session_type: str) -> str:
    return f"sessions/{year}/{round_num}/{session_type}/replay"


def manifest_path(year: int, round_num: int, session_type: str) -> str:
    return f"{replay_prefix(year, round_num, session_type)}/manifest.json"


def chunk_path(year: int, round_num: int, session_type: str, version: str, index: int) -> str:
    return f"{replay_prefix(year, round_num, session_type)}/{version}/chunk-{index:04d}.json"


def get_manifest(year: int, round_num: int, session_type: str) -> dict | None:
    return storage.get_json(manifest_path(year, round_num, session_type))


# ---------------------------------------------------------------------------
# Pit position prediction (precomputed into each frame)
# ---------------------------------------------------------------------------

def parse_gap_seconds(gap: str | None) -> float | None:
    """Parse a gap string into seconds. Returns None for non-numeric gaps."""
    if not gap:
        return None
    if gap.startswith("LAP "):
        return None  # Leader — no gap
    m = re.match(r"^\+?([\d.]+)$", gap)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d+)\s*L(?:ap)?", gap)
    if m:
        return None  # Lapped — can't meaningfully predict
    return None


def add_pit_predictions(frame: dict, pit_loss_green: float, pit_loss_sc: float, pit_loss_vsc: float):
    """Add pit_prediction field to each driver in the frame."""
    drivers = frame.get("drivers", [])
    status = frame.get("status", "green")
    lap = frame.get("lap", 0)

    # Don't show before lap 5
    if lap < 5:
        return

    # Select pit loss based on track status
    if status == "sc":
        pit_loss = pit_loss_sc
    elif status == "vsc":
        pit_loss = pit_loss_vsc
    else:
        pit_loss = pit_loss_green

    # Build list of (driver_abbr, gap_seconds) for drivers currently on track
    driver_gaps: list[tuple[str, float]] = []
    for d in drivers:
        if d.get("retired") or d.get("in_pit"):
            continue
        gap = d.get("gap")
        if d.get("position") == 1:
            driver_gaps.append((d["abbr"], 0.0))
        else:
            gap_sec = parse_gap_seconds(gap)
            if gap_sec is not None:
                driver_gaps.append((d["abbr"], gap_sec))

    if not driver_gaps:
        return

    # Sort by gap (ascending = leader first)
    driver_gaps.sort(key=lambda x: x[1])

    for d in drivers:
        if d.get("retired") or d.get("in_pit"):
            d["pit_prediction"] = None
            continue

        if d.get("position") == 1:
            current_gap = 0.0
        else:
            current_gap = parse_gap_seconds(d.get("gap"))

        if current_gap is None:
            d["pit_prediction"] = None
            continue

        projected_gap = current_gap + pit_loss

        # Build gap list excluding this driver
        other_gaps = [g for abbr, g in driver_gaps if abbr != d["abbr"]]

        # Find what position this projected gap would be
        predicted_pos = 1
        for g in other_gaps:
            if projected_gap > g:
                predicted_pos += 1
            else:
                break

        # Cap at field size
        predicted_pos = min(predicted_pos, len(other_gaps) + 1)

        # Only show if they'd lose at least 1 position
        if predicted_pos > (d.get("position") or 0):
            d["pit_prediction"] = predicted_pos
            # Margin to the driver one position behind
            behind_idx = predicted_pos - 1  # index into other_gaps for car behind
            if behind_idx < len(other_gaps):
                margin = other_gaps[behind_idx] - projected_gap
                d["pit_prediction_margin"] = round(max(0.0, margin), 3)
            else:
                d["pit_prediction_margin"] = None
            # Free air — gap to the car one position ahead
            ahead_idx = predicted_pos - 2  # index into other_gaps for car ahead
            if ahead_idx >= 0:
                free_air = projected_gap - other_gaps[ahead_idx]
                d["pit_prediction_free_air"] = round(max(0.0, free_air), 1)
            else:
                d["pit_prediction_free_air"] = None
        else:
            d["pit_prediction"] = None
            d["pit_prediction_margin"] = None
            d["pit_prediction_free_air"] = None


def pit_loss_for(year: int, round_num: int, session_type: str) -> tuple[float, float, float]:
    """(green, sc, vsc) pit loss in seconds, or zeros when predictions don't apply."""
    if session_type not in ("R", "S"):
        return 0.0, 0.0, 0.0
    pit_data = storage.get_json("pit_loss.json")
    if not pit_data:
        return 0.0, 0.0, 0.0
    info = storage.get_json(f"sessions/{year}/{round_num}/{session_type}/info.json")
    event_name = info.get("event_name", "") if info else ""
    entry = pit_data.get("circuits", {}).get(event_name)
    if entry:
        return (
            entry.get("pit_loss_green", 0) or 0,
            entry.get("pit_loss_sc", 0) or 0,
            entry.get("pit_loss_vsc", 0) or 0,
        )
    # Fallback to global averages
    ga = pit_data.get("global_averages", {})
    return ga.get("green", 22.0), ga.get("sc", 10.0), ga.get("vsc", 14.5)


# ---------------------------------------------------------------------------
# Frame preparation
# ---------------------------------------------------------------------------

def _clean(value):
    """Replace NaN/Infinity anywhere in a frame with None so it's valid JSON."""
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (float, dict, list)):
                value[k] = _clean(v)
        return value
    if isinstance(value, list):
        for i, v in enumerate(value):
            if isinstance(v, (float, dict, list)):
                value[i] = _clean(v)
        return value
    return value


def prepare_frames(frames: list[dict], pit_loss: tuple[float, float, float]) -> list[dict]:
    """Clean frames and add pit predictions, exactly as the WebSocket player sends them."""
    green, sc, vsc = pit_loss
    for f in frames:
        _clean(f)
        if green > 0:
            add_pit_predictions(f, green, sc, vsc)
    return frames


def _lap_starts(frames: list[dict]) -> list[list]:
    """[[lap, timestamp], ...] — the first timestamp each new highest lap appears."""
    starts = []
    highest = None
    for f in frames:
        lap = f.get("lap", 0)
        if highest is None or lap > highest:
            starts.append([lap, f["timestamp"]])
            highest = lap
    return starts


def _quali_phases(frames: list[dict]) -> list[dict] | None:
    phases = []
    seen = set()
    for f in frames:
        qp = f.get("quali_phase")
        if qp and qp["phase"] not in seen:
            seen.add(qp["phase"])
            phases.append({"phase": qp["phase"], "timestamp": f["timestamp"]})
    return phases or None


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def write_chunks(year: int, round_num: int, session_type: str, frames: list[dict]) -> dict | None:
    """Prepare frames, write them as chunks plus a manifest, and drop older versions.

    The manifest is written last, so a reader never sees a manifest whose
    chunks are missing.
    """
    if not frames:
        return None

    prepare_frames(frames, pit_loss_for(year, round_num, session_type))

    version = str(int(time.time() * 1000))
    groups: dict[int, list[dict]] = {}
    for f in frames:
        groups.setdefault(int(max(0.0, f["timestamp"]) // CHUNK_SECONDS), []).append(f)

    chunks = []
    for index in sorted(groups):
        group = groups[index]
        storage.put_json(chunk_path(year, round_num, session_type, version, index), group)
        chunks.append({
            "index": index,
            "start": group[0]["timestamp"],
            "end": group[-1]["timestamp"],
            "frames": len(group),
        })

    manifest = {
        "format": FORMAT,
        "version": version,
        "chunk_seconds": CHUNK_SECONDS,
        "total_frames": len(frames),
        "total_time": frames[-1]["timestamp"],
        "total_laps": frames[-1].get("total_laps", 0),
        "quali_phases": _quali_phases(frames),
        "laps": _lap_starts(frames),
        "chunks": chunks,
    }
    storage.put_json(manifest_path(year, round_num, session_type), manifest)

    _delete_old_versions(year, round_num, session_type, keep=version)
    logger.info(
        f"[chunks] {year}/{round_num}/{session_type}: {len(frames)} frames in "
        f"{len(chunks)} chunks (version {version})"
    )
    return manifest


def _delete_old_versions(year: int, round_num: int, session_type: str, keep: str) -> None:
    prefix = replay_prefix(year, round_num, session_type) + "/"
    try:
        stale = [
            k for k in storage.list_keys(prefix)
            if not k.endswith("/manifest.json") and f"/replay/{keep}/" not in k
        ]
        if stale:
            storage.delete_keys(stale)
    except Exception as e:
        logger.warning(f"[chunks] Could not remove old chunk versions under {prefix}: {e}")


def build_from_replay_json(year: int, round_num: int, session_type: str) -> dict | None:
    """Convert a session processed before chunks existed. One at a time."""
    with _build_lock:
        existing = get_manifest(year, round_num, session_type)
        if existing:
            return existing
        frames = storage.get_json(f"sessions/{year}/{round_num}/{session_type}/replay.json")
        if not frames:
            return None
        try:
            return write_chunks(year, round_num, session_type, frames)
        finally:
            del frames
            gc.collect()
