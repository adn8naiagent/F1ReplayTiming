"""
Live State Manager for F1 live timing.

Accumulates incremental SignalR updates and maintains a complete session state
that matches the ReplayFrame shape used by the existing replay system.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections import deque
from datetime import timezone
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Track status code → normalised status string
_TRACK_STATUS_MAP: dict[str, str] = {
    "1": "green",
    "2": "yellow",
    "4": "sc",
    "5": "red",
    "6": "vsc",
    "7": "vsc",  # VSC ending
}


def _parse_gap_seconds(gap: str | None) -> float | None:
    """Parse a gap string like '+1.234' into seconds.  Returns None for
    non-numeric gaps (leader, lapped, etc.)."""
    if not gap:
        return None
    if gap.startswith("LAP "):
        return None
    m = re.match(r"^\+?([\d.]+)$", gap)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d+)\s*L(?:ap)?", gap)
    if m:
        return None
    return None


def _parse_remaining(remaining: str) -> float:
    """Parse a time string like '00:15:32.000' into total seconds."""
    try:
        parts = remaining.split(":")
        if len(parts) == 3:
            h, m, rest = parts
            s = float(rest)
            return int(h) * 3600 + int(m) * 60 + s
        if len(parts) == 2:
            m, rest = parts
            s = float(rest)
            return int(m) * 60 + s
        return float(remaining)
    except (ValueError, IndexError):
        return 0.0


def _sanitize_value(val: Any) -> Any:
    """Replace NaN / Infinity floats with None."""
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


class _DriverState:
    """Mutable per-driver state."""

    __slots__ = (
        "racing_number",
        "abbr",
        "team",
        "color",
        "position",
        "gap",
        "interval",
        "compound",
        "tyre_life",
        "tyre_history",
        "pit_stops",
        "in_pit",
        "out_lap",
        "has_fastest_lap",
        "flag",
        "retired",
        "knocked_out",
        "no_timing",
        "grid_position",
        "sectors",
        "pit_prediction",
        "pit_prediction_margin",
        "pit_prediction_free_air",
        "best_lap_time",
        "last_lap",
        "pit_start",
        "x",
        "y",
        "relative_distance",
        "on_track",
        "speed",
        "throttle",
        "brake",
        "gear",
        "rpm",
        "drs",
        "first_name",
        "last_name",
        "_sector_best_personal",
        "_sector_best_overall",
        "_stint_count",
        "_laps_completed",
        "_last_stint_idx",
        "_s3_complete_time",
        "_sector_times",
        "_mini",
    )

    def __init__(self, racing_number: str) -> None:
        self.racing_number: str = racing_number
        self.abbr: str = ""
        self.team: str = ""
        self.color: str = "#FFFFFF"
        self.position: int | None = None
        self.gap: str | None = None
        self.interval: str | None = None
        self.compound: str | None = None
        self.tyre_life: int | None = None
        self.tyre_history: list[str] = []
        self._last_stint_idx: int = -1
        self.pit_stops: int = 0
        self.in_pit: bool = False
        self.out_lap: bool = False  # from pit exit until the lap is completed
        self.has_fastest_lap: bool = False
        self.flag: str | None = None  # "investigation" | "penalty" | None
        self.retired: bool = False
        self.knocked_out: bool = False
        self.no_timing: bool = False
        self.grid_position: int | None = None
        self.sectors: list[dict[str, Any]] | None = None
        self.pit_prediction: int | None = None
        self.pit_prediction_margin: float | None = None
        self.pit_prediction_free_air: float | None = None
        self.best_lap_time: str | None = None
        # Most recent lap: {"time", "personal", "overall"} from F1's flags
        self.last_lap: dict[str, Any] | None = None
        self.pit_start: bool = False
        self.x: float = 0.0
        self.y: float = 0.0
        self.relative_distance: float = 0.0
        self.on_track: bool = False
        # Telemetry from CarData.z, only sent with an F1 TV sign-in
        self.speed: float | None = None
        self.throttle: float | None = None
        self.brake: bool = False
        self.gear: int | None = None
        self.rpm: float | None = None
        self.drs: int | None = None
        self.first_name: str | None = None  # for team radio captions
        self.last_name: str | None = None
        # Internal tracking for sector colours
        self._sector_best_personal: dict[int, float] = {}  # sector_num -> best time
        self._sector_best_overall: dict[int, bool] = {}  # sector_num -> ever overall fastest
        self._s3_complete_time: float | None = None  # timestamp when S3 completed (for 5s linger)
        self._sector_times: dict[int, float] = {}  # sector_num -> time in seconds (for colour recomputation)
        self._mini: dict[tuple[int, int], int] = {}  # (sector, segment) -> mini-sector status
        self._stint_count: int = 0
        self._laps_completed: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "abbr": self.abbr,
            "position": self.position,
            "gap": self.gap,
            "interval": self.interval,
            "color": self.color,
            "team": self.team,
            "compound": self.compound,
            "tyre_life": self.tyre_life,
            "tyre_history": list(self.tyre_history[-2:]) if self.tyre_history else [],
            "pit_stops": self.pit_stops,
            "in_pit": self.in_pit,
            "out_lap": self.out_lap,
            "has_fastest_lap": self.has_fastest_lap,
            "flag": self.flag,
            "retired": self.retired,
            "knocked_out": self.knocked_out,
            "no_timing": self.no_timing,
            "grid_position": self.grid_position,
            "sectors": self.sectors,
            "best_lap_time": self.best_lap_time,
            "last_lap": self.last_lap,
            "pit_prediction": self.pit_prediction,
            "pit_prediction_margin": self.pit_prediction_margin,
            "pit_prediction_free_air": self.pit_prediction_free_air,
            "pit_start": self.pit_start,
            "x": self.x,
            "y": self.y,
            "relative_distance": self.relative_distance,
            "speed": self.speed,
            "throttle": self.throttle,
            "brake": self.brake,
            "gear": self.gear,
            "rpm": self.rpm,
            "drs": self.drs,
        }


class LiveStateManager:
    """Accumulates incremental SignalR messages and produces complete
    ReplayFrame-shaped snapshots on demand.

    Parameters
    ----------
    session_type:
        One of "R", "Q", "S", "SQ", "FP1", "FP2", "FP3", etc.
    pit_loss_green:
        Estimated pit stop time loss under green flag conditions (seconds).
    pit_loss_sc:
        Estimated pit stop time loss under safety car (seconds).
    pit_loss_vsc:
        Estimated pit stop time loss under virtual safety car (seconds).
    """

    def __init__(
        self,
        session_type: str,
        pit_loss_green: float = 0.0,
        pit_loss_sc: float = 0.0,
        pit_loss_vsc: float = 0.0,
        track_norm: dict[str, float] | None = None,
        track_points: list[dict[str, float]] | None = None,
        clock_rate: float = 1.0,
    ) -> None:
        self._session_type: str = session_type
        self._pit_loss_green: float = pit_loss_green
        self._pit_loss_sc: float = pit_loss_sc
        self._pit_loss_vsc: float = pit_loss_vsc

        # Track normalization: raw F1 coords -> 0-1 normalized
        # norm = {"x_min": float, "y_min": float, "scale": float}
        self._track_norm: dict[str, float] | None = track_norm

        # Track outline as numpy arrays for nearest-point lookup
        self._track_xy: np.ndarray | None = None  # shape (N, 2)
        if track_points:
            self._track_xy = np.array(
                [[p["x"], p["y"]] for p in track_points], dtype=np.float64
            )

        # Auto-normalization from raw position data (fallback when no track_norm)
        self._raw_x_min: float = float("inf")
        self._raw_x_max: float = float("-inf")
        self._raw_y_min: float = float("inf")
        self._raw_y_max: float = float("-inf")
        self._position_samples: int = 0

        # Per-driver state keyed by racing number string
        self._drivers: dict[str, _DriverState] = {}

        # Car positions arrive about once a second, each message holding the
        # last few samples (~0.3s apart). Showing only the newest makes cars
        # jump once a second, so keep the samples and play them out a little
        # behind, interpolating between them like the replay does.
        # number -> deque of (sample time, x, y, relative distance)
        self._pos_samples: dict[str, deque[tuple[float, float, float, float]]] = {}
        self._pos_newest: float | None = None  # newest sample time seen
        self._pos_newest_at: float = 0.0  # monotonic time it arrived
        self._pos_display: float | None = None  # sample time shown now
        self._pos_display_at: float = 0.0  # monotonic time of that
        self._clock_rate: float = clock_rate  # test replayer speed, else 1

        # Session-level state
        self._status: str = "green"
        self._weather: dict[str, Any] | None = None
        self._current_lap: int = 0
        self._total_laps: int = 0
        self._session_status: str = "Inactive"  # Inactive, Started, Finished, Finalised, Ends
        self._session_was_started: bool = False
        self._quali_phase: int = 0  # 0 = unknown, 1/2/3
        self._clock_remaining: float = 0.0
        self._clock_extrapolating: bool = False
        self._clock_utc: str = ""
        self._clock_update_time: float = 0.0  # monotonic time when clock was last set
        self._last_timestamp: float = 0.0
        self._seen_topics: set[str] = set()

        # Race control messages (most recent first, capped at 50)
        self._rc_messages: list[dict[str, Any]] = []

        # Marshal sector flags in force: sector number -> {"sector", "flag", "driver"}
        self._sector_flags: dict[int, dict[str, Any]] = {}

        # Overall sector bests (sector index 0-2 -> best time)
        self._overall_sector_bests: dict[int, float] = {}

        # Mini-sectors per sector, from the highest segment index seen
        self._mini_counts: list[int] = [0, 0, 0]

        # Team radio (F1 TV sign-in only). Clips go out in frames once
        # captioned; "state" is "new", "captioning", "ready" or "skipped".
        self._session_path: str | None = None  # e.g. "2026/..._Grand_Prix/..._Race/"
        self._session_label: str | None = None  # e.g. "United States Grand Prix, Qualifying"
        self._radio: dict[str, dict[str, Any]] = {}  # clip path -> clip

    # ------------------------------------------------------------------
    # Driver helpers
    # ------------------------------------------------------------------

    def _get_driver(self, number: str) -> _DriverState:
        """Get or create a driver state entry."""
        if number not in self._drivers:
            self._drivers[number] = _DriverState(number)
        return self._drivers[number]

    @property
    def _is_race(self) -> bool:
        return self._session_type in ("R", "S")

    @property
    def _is_quali(self) -> bool:
        return self._session_type in ("Q", "SQ")

    @property
    def session_status(self) -> str:
        """Current session status (Inactive, Started, Finished, Finalised, Ends)."""
        return self._session_status

    # ------------------------------------------------------------------
    # Message processing
    # ------------------------------------------------------------------

    def process_message(self, topic: str, data: dict, timestamp: float) -> None:
        """Process a single SignalR message.

        Parameters
        ----------
        topic:
            The SignalR hub topic name (e.g. "TimingData", "WeatherData").
        data:
            The message payload dict.
        timestamp:
            Unix epoch timestamp of when the message was received.
        """
        self._last_timestamp = timestamp

        if topic not in self._seen_topics:
            self._seen_topics.add(topic)
            logger.info("First message for topic: %s", topic)

        handler = self._HANDLERS.get(topic)
        if handler is not None:
            try:
                handler(self, data, timestamp)
            except Exception:
                logger.exception("Error processing %s message", topic)

    # --- DriverList ---------------------------------------------------

    def _handle_driver_list(self, data: dict, _ts: float) -> None:
        for number, info in data.items():
            if not isinstance(info, dict):
                continue
            drv = self._get_driver(str(number))
            if "Tla" in info:
                drv.abbr = info["Tla"]
            if "TeamName" in info:
                drv.team = info["TeamName"]
            if "FirstName" in info:
                drv.first_name = info["FirstName"]
            if "LastName" in info:
                drv.last_name = str(info["LastName"]).title()
            if "TeamColour" in info:
                colour = info["TeamColour"]
                if not colour.startswith("#"):
                    colour = "#" + colour
                drv.color = colour

    # --- TimingData ---------------------------------------------------

    def _handle_timing_data(self, data: dict, _ts: float) -> None:
        lines = data.get("Lines")
        if not lines:
            return
        for number, updates in lines.items():
            if not isinstance(updates, dict):
                continue
            drv = self._get_driver(str(number))

            if "Position" in updates:
                try:
                    drv.position = int(updates["Position"])
                except (ValueError, TypeError):
                    pass

            if "GapToLeader" in updates:
                val = updates["GapToLeader"]
                if isinstance(val, dict):
                    val = val.get("Value", "")
                drv.gap = val if val else drv.gap

            if "IntervalToPositionAhead" in updates:
                ival = updates["IntervalToPositionAhead"]
                if isinstance(ival, dict):
                    ival = ival.get("Value", "")
                drv.interval = ival if ival else drv.interval

            # BestLapTime — store as best_lap_time for practice/qualifying
            if "BestLapTime" in updates:
                blt = updates["BestLapTime"]
                if isinstance(blt, dict):
                    blt_val = blt.get("Value", "")
                else:
                    blt_val = str(blt) if blt else ""
                if blt_val:
                    drv.best_lap_time = blt_val

            # LastLapTime, with F1's colour flags (partial updates send only
            # what changed, e.g. just PersonalFastest)
            if isinstance(updates.get("LastLapTime"), dict):
                llt = updates["LastLapTime"]
                last = dict(drv.last_lap or {"time": None, "personal": False, "overall": False})
                if "Value" in llt:
                    last["time"] = llt["Value"] or None
                if "PersonalFastest" in llt:
                    last["personal"] = bool(llt["PersonalFastest"])
                if "OverallFastest" in llt:
                    last["overall"] = bool(llt["OverallFastest"])
                drv.last_lap = last if last["time"] else None

            # Out-lap: set on pit exit, cleared once the lap is completed.
            # A lap completed in the pit lane (crossing the line on the way
            # out) doesn't count, so check laps before applying pit updates.
            if "NumberOfLaps" in updates:
                try:
                    laps_done = int(updates["NumberOfLaps"])
                    if (drv._laps_completed is not None
                            and laps_done > drv._laps_completed
                            and not drv.in_pit):
                        drv.out_lap = False
                    drv._laps_completed = laps_done
                except (ValueError, TypeError):
                    pass

            if "InPit" in updates:
                in_pit = bool(updates["InPit"])
                if drv.in_pit and not in_pit:
                    drv.out_lap = True
                elif in_pit:
                    drv.out_lap = False
                drv.in_pit = in_pit

            if updates.get("PitOut"):
                drv.out_lap = True

            if "Retired" in updates:
                if updates["Retired"]:
                    drv.retired = True

            if "KnockedOut" in updates:
                # Keep knocked-out drivers visible with their posted time; the
                # frontend dims them rather than dropping them out of timing.
                drv.knocked_out = bool(updates["KnockedOut"])

            # Sectors (qualifying sector indicators)
            if "Sectors" in updates:
                sectors_raw = updates["Sectors"]
                if isinstance(sectors_raw, list):
                    sectors_raw = {str(i): v for i, v in enumerate(sectors_raw) if isinstance(v, dict)}
                if isinstance(sectors_raw, dict):
                    self._process_mini_sectors(drv, sectors_raw)
                    self._process_sectors(drv, sectors_raw)

            # Status / no_timing detection
            if "Status" in updates:
                status_val = updates["Status"]
                if not status_val or (isinstance(status_val, dict) and not status_val):
                    drv.no_timing = True
            # If a driver has no position and no gap, mark no_timing
            if drv.position is None and not drv.gap:
                drv.no_timing = True
            else:
                drv.no_timing = False

    def _process_sectors(self, drv: _DriverState, sectors: dict) -> None:
        """Update sector colour indicators for a driver.

        Only updates when a sector has an actual Value (completed time).
        When sector N completes, clears all sectors after N (new flying
        lap progress). Computes colours from actual times rather than
        trusting API flags, ensuring only one driver can be purple per sector.
        """
        # Build lookup of existing sectors
        existing: dict[int, dict[str, Any]] = {}
        if drv.sectors:
            for s in drv.sectors:
                existing[s["num"]] = s

        for idx_str, sector_data in sorted(sectors.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0):
            if not isinstance(sector_data, dict):
                continue
            try:
                sector_idx = int(idx_str)
            except ValueError:
                continue
            sector_num = sector_idx + 1  # 0-based -> 1-based

            val_str = sector_data.get("Value", "")

            # Only process sectors that have an actual completed time
            if not val_str:
                continue

            # Parse sector time
            try:
                sec_time = float(val_str)
            except ValueError:
                continue

            # Store the sector time for later recomputation
            drv._sector_times[sector_idx] = sec_time

            # Track personal bests
            current_pb = drv._sector_best_personal.get(sector_idx)
            is_personal_best = current_pb is None or sec_time <= current_pb + 0.0005
            if current_pb is None or sec_time < current_pb:
                drv._sector_best_personal[sector_idx] = sec_time

            # Track overall bests — if this is a new overall best, update
            # all other drivers' sectors to remove stale purples
            current_ob = self._overall_sector_bests.get(sector_idx)
            is_overall_best = current_ob is None or sec_time <= current_ob + 0.0005
            if current_ob is None or sec_time < current_ob:
                self._overall_sector_bests[sector_idx] = sec_time
                # Downgrade other drivers' purple in this sector
                self._recompute_sector_colours(sector_idx, drv.racing_number)

            # Determine colour from actual times
            if is_overall_best:
                color = "purple"
            elif is_personal_best:
                color = "green"
            else:
                color = "yellow"

            existing[sector_num] = {"num": sector_num, "color": color}

            # Clear any sectors after this one (new lap progress)
            for later in list(existing):
                if later > sector_num:
                    del existing[later]
                    drv._sector_times.pop(later - 1, None)

            # Track S3 completion for 5-second linger
            if sector_num == 3:
                drv._s3_complete_time = time.monotonic()
            elif sector_num == 1:
                # Starting new lap — reset S3 timer
                drv._s3_complete_time = None

        drv.sectors = [existing[k] for k in sorted(existing)] if existing else None

    def _process_mini_sectors(self, drv: _DriverState, sectors: dict) -> None:
        """Mini-sector colours as F1 sends them (see services/minisectors.py
        for the statuses). F1 clears them itself at the start of each lap."""
        from services.minisectors import _items

        for si, sector in sectors.items():
            if not isinstance(sector, dict):
                continue
            for gi, seg in _items(sector.get("Segments")):
                if not isinstance(seg, dict) or "Status" not in seg:
                    continue
                try:
                    s, g, status = int(si), int(gi), int(seg["Status"])
                except (ValueError, TypeError):
                    continue
                if not 0 <= s <= 2:
                    continue
                self._mini_counts[s] = max(self._mini_counts[s], g + 1)
                drv._mini[(s, g)] = status

    def _mini_states(self, drv: _DriverState) -> list[int]:
        """A driver's mini-sector statuses, flat in lap order (0 = not yet)."""
        return [drv._mini.get((s, g), 0) for s in range(3) for g in range(self._mini_counts[s])]

    def _recompute_sector_colours(self, sector_idx: int, exclude_rn: str) -> None:
        """When a new overall best is set in a sector, downgrade other drivers'
        purple indicators for that sector to green or yellow."""
        sector_num = sector_idx + 1
        new_best = self._overall_sector_bests.get(sector_idx)
        if new_best is None:
            return

        for drv in self._drivers.values():
            if drv.racing_number == exclude_rn:
                continue
            if not drv.sectors:
                continue
            for s in drv.sectors:
                if s["num"] == sector_num and s["color"] == "purple":
                    # Check if this driver's time is still a personal best
                    drv_time = drv._sector_times.get(sector_idx)
                    drv_pb = drv._sector_best_personal.get(sector_idx)
                    if drv_time is not None and drv_pb is not None and drv_time <= drv_pb + 0.0005:
                        s["color"] = "green"
                    else:
                        s["color"] = "yellow"

    # --- Position -----------------------------------------------------

    def _handle_position(self, data: dict, _ts: float) -> None:
        """Handle Position data (decoded from Position.z).

        Expected structure:
        {
            "Position": [
                {
                    "Timestamp": "...",
                    "Entries": {
                        "1": {"X": int, "Y": int, "Z": int, "Status": "OnTrack"},
                        ...
                    }
                }
            ]
        }
        """
        position_list = data.get("Position")
        if not position_list or not isinstance(position_list, list):
            return

        from services.team_radio import parse_utc

        # Collect all raw coordinates from this batch, with each sample's time
        raw_positions: list[tuple[str, float, float, str, float | None]] = []
        for sample in position_list:
            entries = sample.get("Entries")
            if not entries or not isinstance(entries, dict):
                continue
            utc = parse_utc(sample.get("Timestamp", ""))
            sample_t = utc.replace(tzinfo=timezone.utc).timestamp() if utc else None
            for number, pos_data in entries.items():
                if not isinstance(pos_data, dict):
                    continue
                raw_x = pos_data.get("X")
                raw_y = pos_data.get("Y")
                if raw_x is None or raw_y is None:
                    continue
                status = pos_data.get("Status", "")
                raw_positions.append((str(number), float(raw_x), float(raw_y), status, sample_t))

        if not raw_positions:
            return

        # If no precomputed track_norm, auto-compute from position data
        if self._track_norm is None:
            for _, rx, ry, _, _ in raw_positions:
                self._raw_x_min = min(self._raw_x_min, rx)
                self._raw_x_max = max(self._raw_x_max, rx)
                self._raw_y_min = min(self._raw_y_min, ry)
                self._raw_y_max = max(self._raw_y_max, ry)
                self._position_samples += 1

            x_range = self._raw_x_max - self._raw_x_min
            y_range = self._raw_y_max - self._raw_y_min
            scale = max(x_range, y_range)

            if scale < 1.0 or self._position_samples < 5:
                # Not enough data yet to normalize — store raw and wait
                return

            # Add 5% padding so cars aren't at the very edge
            padding = scale * 0.05
            x_min = self._raw_x_min - padding
            y_min = self._raw_y_min - padding
            scale = scale + 2 * padding
        else:
            x_min = self._track_norm["x_min"]
            y_min = self._track_norm["y_min"]
            scale = self._track_norm["scale"]

        for number, raw_x, raw_y, status, sample_t in raw_positions:
            drv = self._get_driver(number)
            drv.on_track = status == "OnTrack"

            # Normalize raw Position.z coordinates
            norm_x = (raw_x - x_min) / scale
            norm_y = (raw_y - y_min) / scale

            # Snap to nearest track outline point so cars render ON the
            # track.  Position.z coordinates don't perfectly align with
            # the FastF1-derived track outline, so using raw normalized
            # values puts cars visibly off-track.
            if self._track_xy is not None:
                rel_dist, snap_x, snap_y = self._snap_to_track(norm_x, norm_y)
                drv.x = snap_x
                drv.y = snap_y
                drv.relative_distance = rel_dist
            else:
                drv.x = norm_x
                drv.y = norm_y

            if sample_t is not None:
                samples = self._pos_samples.setdefault(number, deque(maxlen=40))
                if not samples or sample_t > samples[-1][0]:
                    samples.append((sample_t, drv.x, drv.y, drv.relative_distance))
                if self._pos_newest is None or sample_t > self._pos_newest:
                    self._pos_newest = sample_t
                    self._pos_newest_at = time.monotonic()

    # How far behind the newest sample positions are shown: longer than the
    # gap between messages (up to ~1.2s), so there's always a next sample.
    _POS_LAG = 1.5

    def _apply_smoothed_positions(self) -> None:
        """Set each car's x/y to its interpolated position on the display clock."""
        if self._pos_newest is None:
            return
        now = time.monotonic()
        # Where the newest sample is now, allowing for time since it arrived
        target = self._pos_newest + (now - self._pos_newest_at) * self._clock_rate - self._POS_LAG
        if self._pos_display is None or abs(target - self._pos_display) > 3 * max(self._clock_rate, 1):
            display = target  # start, or a skip forward
        else:
            # Advance steadily, easing towards the target, so message timing
            # jitter doesn't make the clock (and the cars) lurch.
            display = self._pos_display + (now - self._pos_display_at) * self._clock_rate
            display += (target - display) * 0.1
            display = max(display, self._pos_display)
        display = min(display, self._pos_newest)
        self._pos_display, self._pos_display_at = display, now

        for number, samples in self._pos_samples.items():
            drv = self._drivers.get(number)
            if drv is None or not samples:
                continue
            if display <= samples[0][0]:
                _, drv.x, drv.y, drv.relative_distance = samples[0]
                continue
            if display >= samples[-1][0]:
                _, drv.x, drv.y, drv.relative_distance = samples[-1]
                continue
            for (t0, x0, y0, d0), (t1, x1, y1, d1) in zip(samples, list(samples)[1:]):
                if t0 <= display <= t1:
                    f = (display - t0) / (t1 - t0) if t1 > t0 else 1.0
                    drv.x = x0 + (x1 - x0) * f
                    drv.y = y0 + (y1 - y0) * f
                    if d1 < d0 - 0.5:  # crossed the line
                        d1 += 1.0
                    drv.relative_distance = (d0 + (d1 - d0) * f) % 1.0
                    break

    # --- CarData (decoded from CarData.z, F1 TV sign-in only) -----------

    # Channel numbers in CarData entries, as used by FastF1.
    _CAR_CHANNELS = {"0": "rpm", "2": "speed", "3": "gear", "4": "throttle", "5": "brake", "45": "drs"}

    def _handle_car_data(self, data: dict, _ts: float) -> None:
        """Expected structure:
        {"Entries": [{"Utc": "...", "Cars": {"1": {"Channels": {"0": 11000, "2": 290, ...}}}}]}
        Only the latest entry matters for a 2 Hz frame.
        """
        entries = data.get("Entries")
        if not entries or not isinstance(entries, list):
            return
        cars = (entries[-1] or {}).get("Cars") or {}
        for number, car in cars.items():
            channels = (car or {}).get("Channels") or {}
            drv = self._get_driver(number)
            for channel, name in self._CAR_CHANNELS.items():
                if channel not in channels:
                    continue
                value = _sanitize_value(channels[channel])
                # Throttle and brake above 100 are "no data" (104 while the
                # car is in the garage), not a reading
                if name in ("throttle", "brake") and isinstance(value, (int, float)) and value > 100:
                    value = 0
                if name == "brake":
                    drv.brake = bool(value)
                elif name in ("gear", "drs"):
                    setattr(drv, name, int(value) if value is not None else None)
                else:
                    setattr(drv, name, value)

    def _snap_to_track(self, x: float, y: float) -> tuple[float, float, float]:
        """Snap a position to the nearest point on the track outline.

        Returns (relative_distance, track_x, track_y) where the x,y are the
        coordinates of the nearest track outline point.
        """
        track = self._track_xy
        if track is None or len(track) == 0:
            return 0.0, x, y
        dx = track[:, 0] - x
        dy = track[:, 1] - y
        dist_sq = dx * dx + dy * dy
        nearest_idx = int(np.argmin(dist_sq))
        return (
            nearest_idx / len(track),
            float(track[nearest_idx, 0]),
            float(track[nearest_idx, 1]),
        )

    # --- TimingAppData ------------------------------------------------

    def _handle_timing_app_data(self, data: dict, _ts: float) -> None:
        lines = data.get("Lines")
        if not lines:
            return
        for number, updates in lines.items():
            if not isinstance(updates, dict):
                continue
            drv = self._get_driver(str(number))

            if "GridPos" in updates:
                try:
                    drv.grid_position = int(updates["GridPos"])
                except (ValueError, TypeError):
                    pass

            if "Stints" in updates:
                stints_raw = updates["Stints"]
                if isinstance(stints_raw, list):
                    # Initial dump sends array — convert to dict
                    stints_raw = {str(i): v for i, v in enumerate(stints_raw) if isinstance(v, dict)}
                if isinstance(stints_raw, dict):
                    self._process_stints(drv, stints_raw)

    def _process_stints(self, drv: _DriverState, stints: dict) -> None:
        """Process stint data — update compound, tyre_life, pit_stops, tyre_history."""
        # Find the highest-index stint (the current one)
        max_idx = -1
        latest_stint: dict | None = None
        for idx_str, stint_data in stints.items():
            if not isinstance(stint_data, dict):
                continue
            try:
                idx = int(idx_str)
            except ValueError:
                continue
            if idx > max_idx:
                max_idx = idx
                latest_stint = stint_data

        if latest_stint is None:
            return

        # Update compound
        if "Compound" in latest_stint:
            new_compound = latest_stint["Compound"].upper()
            # Ignore interim/placeholder compounds
            if new_compound == "UNKNOWN":
                pass
            else:
                # Only add to tyre history when the stint index increases (actual pit stop)
                if max_idx > drv._last_stint_idx and drv._last_stint_idx >= 0 and drv.compound:
                    if not drv.tyre_history or drv.tyre_history[-1] != drv.compound:
                        drv.tyre_history.append(drv.compound)
                drv.compound = new_compound
                drv._last_stint_idx = max_idx

        # Update tyre life
        if "TotalLaps" in latest_stint:
            try:
                drv.tyre_life = int(latest_stint["TotalLaps"])
            except (ValueError, TypeError):
                pass

        # Pit stops = number of stints - 1 (based on highest stint index)
        new_stint_count = max_idx + 1
        if new_stint_count > drv._stint_count:
            drv._stint_count = new_stint_count
            drv.pit_stops = max(0, new_stint_count - 1)

    # --- TimingStats --------------------------------------------------

    def _handle_timing_stats(self, data: dict, _ts: float) -> None:
        lines = data.get("Lines")
        if not lines:
            return

        # Check for fastest lap holder change
        new_fastest_number: str | None = None
        for number, stats in lines.items():
            if not isinstance(stats, dict):
                continue
            pb = stats.get("PersonalBestLapTime")
            if isinstance(pb, dict):
                pos = pb.get("Position")
                if pos == 1 or pos == "1":
                    new_fastest_number = str(number)

        if new_fastest_number is not None:
            for num, drv in self._drivers.items():
                drv.has_fastest_lap = (num == new_fastest_number)

    # --- RaceControlMessages ------------------------------------------

    def _handle_race_control(self, data: dict, ts: float) -> None:
        messages = data.get("Messages")
        if not messages:
            return
        # Messages can be a list (initial dump) or dict (incremental updates)
        if isinstance(messages, list):
            items = enumerate(messages)
        elif isinstance(messages, dict):
            items = messages.items()
        else:
            return
        for _, msg_data in items:
            if not isinstance(msg_data, dict):
                continue
            message = msg_data.get("Message", "")
            category = msg_data.get("Category", "")
            racing_number = msg_data.get("RacingNumber")
            lap = msg_data.get("Lap")
            upper_msg = message.upper()

            # Store the message for the RC feed
            if message:
                rc_entry: dict[str, Any] = {
                    "message": message,
                    "category": category,
                    "timestamp": ts,
                    "lap": lap,
                }
                if racing_number:
                    rc_entry["racing_number"] = str(racing_number)
                self._rc_messages.append(rc_entry)
                # Cap at 50 most recent
                if len(self._rc_messages) > 50:
                    self._rc_messages = self._rc_messages[-50:]

            # Marshal sector flags, as replays show them (f1_data)
            if msg_data.get("Scope") == "Sector" and msg_data.get("Flag") and msg_data.get("Sector") is not None:
                try:
                    sector_num = int(msg_data["Sector"])
                except (TypeError, ValueError):
                    sector_num = None
                if sector_num is not None:
                    flag = str(msg_data["Flag"])
                    if flag in ("CLEAR", "GREEN"):
                        self._sector_flags.pop(sector_num, None)
                    else:
                        drv_abbr = ""
                        if racing_number and str(racing_number) in self._drivers:
                            drv_abbr = self._drivers[str(racing_number)].abbr
                        self._sector_flags[sector_num] = {"sector": sector_num, "flag": flag, "driver": drv_abbr}

            if not racing_number:
                # Try to extract car number from message
                car_match = re.search(r"CAR\s+(\d+)", message)
                if car_match:
                    racing_number = car_match.group(1)

            if not racing_number:
                continue

            drv = self._get_driver(str(racing_number))

            if "NO FURTHER ACTION" in upper_msg or "NO INVESTIGATION" in upper_msg:
                drv.flag = None
            elif "PENALTY SERVED" in upper_msg:
                drv.flag = None
            elif "DECISION" in upper_msg and "PENALTY" not in upper_msg:
                drv.flag = None
            elif "UNDER INVESTIGATION" in upper_msg or "IS NOTED" in upper_msg:
                drv.flag = "investigation"
            elif ("TIME PENALTY" in upper_msg or "PENALTY" in upper_msg) and "NO FURTHER" not in upper_msg:
                drv.flag = "penalty"

    # --- SessionInfo / TeamRadio --------------------------------------

    def _handle_session_info(self, data: dict, _ts: float) -> None:
        path = data.get("Path")
        if isinstance(path, str) and path:
            self._session_path = path
        meeting = (data.get("Meeting") or {}).get("Name") if isinstance(data.get("Meeting"), dict) else None
        name = data.get("Name")
        if meeting or name:
            self._session_label = ", ".join(str(x) for x in (meeting, name) if x)

    def radio_context(self, racing_number: str) -> dict[str, Any]:
        """Who's speaking, the other drivers and the session, for the AI
        caption step (services/caption_ai)."""
        from services.team_radio import _driver_label

        def label(d: _DriverState) -> str:
            name = " ".join(x for x in (d.first_name, d.last_name) if x)
            return _driver_label({"name": name, "abbr": d.abbr, "team": d.team})

        speaker = self._drivers.get(racing_number)
        return {
            "speaker": label(speaker) if speaker and speaker.abbr else None,
            "drivers": [label(d) for d in self._drivers.values() if d.abbr],
            "session": self._session_label,
        }

    def _handle_team_radio(self, data: dict, _ts: float) -> None:
        from services import team_radio

        for cap in team_radio.captures_from(data):
            path = cap.get("Path")
            if not path or path in self._radio:
                continue
            self._radio[path] = {
                "id": path,
                "utc": cap.get("Utc"),
                "racing_number": str(cap.get("RacingNumber", "")),
                "transcript": None,
                "state": "new",
            }

    def take_new_radio(self) -> list[dict[str, Any]]:
        """Clips to caption, marked as in progress. Each comes with its audio
        URL and the driver's first name. Waits for SessionInfo's path."""
        from services import team_radio

        if not self._session_path:
            return []
        out = []
        for clip in self._radio.values():
            if clip["state"] != "new":
                continue
            clip["state"] = "captioning"
            clip["url"] = team_radio.audio_url(self._session_path, clip["id"])
            drv = self._drivers.get(clip["racing_number"])
            out.append({**clip, "first_name": drv.first_name if drv else None})
        return out

    def set_radio_caption(self, clip_id: str, transcript: str | None) -> None:
        clip = self._radio.get(clip_id)
        if clip and clip["state"] == "captioning":
            clip["transcript"] = transcript
            clip["state"] = "ready"

    def skip_new_radio(self) -> None:
        """Clips passed over by a skip forward: never shown or played."""
        for clip in self._radio.values():
            if clip["state"] == "new":
                clip["state"] = "skipped"

    def _radio_frame(self) -> list[dict[str, Any]]:
        """The last few captioned clips, oldest first."""
        ready = [c for c in self._radio.values() if c["state"] == "ready"][-10:]
        out = []
        for c in ready:
            drv = self._drivers.get(c["racing_number"])
            out.append({
                "id": c["id"],
                "utc": c["utc"],
                "racing_number": c["racing_number"],
                "driver": drv.abbr if drv else "",
                "url": c.get("url"),
                "transcript": c["transcript"],
            })
        return out

    # --- TrackStatus --------------------------------------------------

    def _handle_track_status(self, data: dict, _ts: float) -> None:
        status_code = data.get("Status", "")
        mapped = _TRACK_STATUS_MAP.get(str(status_code))
        if mapped:
            self._status = mapped

    # --- WeatherData --------------------------------------------------

    def _handle_weather(self, data: dict, _ts: float) -> None:
        try:
            self._weather = {
                "air_temp": float(data["AirTemp"]) if "AirTemp" in data else (self._weather or {}).get("air_temp"),
                "track_temp": float(data["TrackTemp"]) if "TrackTemp" in data else (self._weather or {}).get("track_temp"),
                "humidity": float(data["Humidity"]) if "Humidity" in data else (self._weather or {}).get("humidity"),
                "rainfall": str(data.get("Rainfall", "0")) != "0" if "Rainfall" in data else (self._weather or {}).get("rainfall", False),
                "wind_speed": float(data["WindSpeed"]) if "WindSpeed" in data else (self._weather or {}).get("wind_speed"),
                "wind_direction": float(data["WindDirection"]) if "WindDirection" in data else (self._weather or {}).get("wind_direction"),
            }
        except (ValueError, TypeError):
            logger.warning("Failed to parse weather data: %s", data)

    # --- LapCount -----------------------------------------------------

    def _handle_lap_count(self, data: dict, _ts: float) -> None:
        if "CurrentLap" in data:
            try:
                self._current_lap = int(data["CurrentLap"])
            except (ValueError, TypeError):
                pass
        if "TotalLaps" in data:
            try:
                self._total_laps = int(data["TotalLaps"])
            except (ValueError, TypeError):
                pass

    # --- ExtrapolatedClock --------------------------------------------

    def _handle_extrapolated_clock(self, data: dict, ts: float) -> None:
        if "Remaining" in data:
            self._clock_remaining = _parse_remaining(data["Remaining"])
            self._clock_update_time = time.monotonic()
        if "Extrapolating" in data:
            self._clock_extrapolating = bool(data["Extrapolating"])
        if "Utc" in data:
            self._clock_utc = data["Utc"]

    # --- SessionStatus ------------------------------------------------

    def _handle_session_status(self, data: dict, _ts: float) -> None:
        if "Status" in data:
            new_status = data["Status"]
            # Track whether the session has ever been active — initial state
            # from Subscribe completion may carry "Finalised" from a prior
            # session, which we must not treat as "session ended".
            if new_status == "Started":
                self._session_was_started = True
                # Pit exits before the start (e.g. laps to the grid) aren't out-laps
                for drv in self._drivers.values():
                    drv.out_lap = False
            self._session_status = new_status

    # --- SessionData --------------------------------------------------

    def _handle_session_data(self, data: dict, _ts: float) -> None:
        series = data.get("Series")
        if not series:
            return
        # Series can be a list or a dict with numeric string keys
        if isinstance(series, list):
            entries = [e for e in series if isinstance(e, dict)]
        elif isinstance(series, dict):
            entries = [e for e in series.values() if isinstance(e, dict)]
        else:
            return
        # Use the last entry (highest qualifying part)
        for entry in reversed(entries):
            if "QualifyingPart" in entry:
                try:
                    self._quali_phase = int(entry["QualifyingPart"])
                except (ValueError, TypeError):
                    pass
                break

    # ------------------------------------------------------------------
    # Handler dispatch table
    # ------------------------------------------------------------------

    _HANDLERS: dict[str, Any] = {
        "DriverList": _handle_driver_list,
        "TimingData": _handle_timing_data,
        "TimingAppData": _handle_timing_app_data,
        "TimingStats": _handle_timing_stats,
        "RaceControlMessages": _handle_race_control,
        "TrackStatus": _handle_track_status,
        "WeatherData": _handle_weather,
        "LapCount": _handle_lap_count,
        "ExtrapolatedClock": _handle_extrapolated_clock,
        "SessionStatus": _handle_session_status,
        "SessionData": _handle_session_data,
        "Position": _handle_position,
        "CarData": _handle_car_data,
        "SessionInfo": _handle_session_info,
        "TeamRadio": _handle_team_radio,
    }

    # ------------------------------------------------------------------
    # Frame construction
    # ------------------------------------------------------------------

    def get_frame(self) -> dict:
        """Build and return a complete frame dict matching the ReplayFrame shape.

        This is intended to be called at ~2 Hz by the broadcaster.
        """
        SECTOR_LINGER = 5.0
        now = time.monotonic()

        self._apply_smoothed_positions()
        # Mini-sectors: qualifying and practice, like replays
        show_mini = not self._is_race and sum(self._mini_counts) > 0

        drivers_list: list[dict[str, Any]] = []
        for drv in self._drivers.values():
            # Skip phantom drivers with no identity (created by Position.z
            # before DriverList arrives)
            if not drv.abbr:
                continue
            # Clear sectors 5 seconds after S3 completes
            if drv._s3_complete_time and (now - drv._s3_complete_time) > SECTOR_LINGER:
                drv.sectors = None
                drv._s3_complete_time = None
                drv._sector_times.clear()
            d = drv.to_dict()
            if show_mini:
                d["mini_sectors"] = self._mini_states(drv)
            # Cars parked in their pit box snap onto the main straight and pile
            # up there, so hide them from the track map (the frontend skips
            # x=0, y=0). Speed comes with telemetry, so this needs F1 TV.
            if drv.in_pit and drv.speed is not None and drv.speed < 1:
                d["x"] = d["y"] = 0.0
            # Sanitize all values
            for key in list(d.keys()):
                d[key] = _sanitize_value(d[key])
            drivers_list.append(d)

        # Sort by position (None positions go to the end)
        drivers_list.sort(key=lambda d: d["position"] if d["position"] is not None else 9999)

        # Set leader gap for races
        if self._is_race and drivers_list:
            for d in drivers_list:
                if d["position"] == 1:
                    d["gap"] = f"LAP {self._current_lap}" if self._current_lap > 0 else d["gap"]
                    break

        # For non-race sessions: compute gap from best_lap_time values
        if not self._is_race and drivers_list:
            self._compute_practice_gaps(drivers_list)

        # Build quali_phase
        quali_phase: dict[str, Any] | None = None
        if self._is_quali and self._quali_phase > 0:
            # Compute remaining time with extrapolation
            remaining = self._clock_remaining
            if self._clock_extrapolating and self._clock_update_time > 0:
                elapsed_since = time.monotonic() - self._clock_update_time
                remaining = max(0.0, remaining - elapsed_since)
            quali_phase = {
                "phase": f"Q{self._quali_phase}",
                "elapsed": 0,  # Not reliably available from live data
                "remaining": round(remaining, 1),
            }

        frame: dict[str, Any] = {
            "timestamp": self._last_timestamp,
            "lap": self._current_lap,
            "total_laps": self._total_laps,
            "session_type": self._session_type,
            "status": self._status,
            "weather": self._weather,
            "quali_phase": quali_phase,
            "drivers": drivers_list,
            "rc_messages": list(reversed(self._rc_messages)),
            "team_radio": self._radio_frame(),
            "sector_flags": list(self._sector_flags.values()) or None,
        }
        if show_mini:
            frame["mini_sector_counts"] = list(self._mini_counts)

        # Add pit predictions for race sessions
        if self._is_race and self._pit_loss_green > 0:
            self._add_pit_predictions(frame)

        # Final sanitization pass on top-level numeric fields
        for key in ("timestamp", "lap", "total_laps"):
            frame[key] = _sanitize_value(frame[key])

        return frame

    # ------------------------------------------------------------------
    # Practice / qualifying gap computation
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_best_lap_seconds(time_str: str | None) -> float | None:
        """Parse a best lap time like '1:23.456' or '83.456' into seconds."""
        if not time_str:
            return None
        try:
            if ":" in time_str:
                parts = time_str.split(":")
                return int(parts[0]) * 60 + float(parts[1])
            return float(time_str)
        except (ValueError, IndexError):
            return None

    @staticmethod
    def _format_lap_time(seconds: float) -> str:
        """Format seconds as M:SS.sss lap time string."""
        mins = int(seconds // 60)
        secs = seconds - mins * 60
        return f"{mins}:{secs:06.3f}"

    def _compute_practice_gaps(self, drivers_list: list[dict[str, Any]]) -> None:
        """Compute best_lap_time display and gap-to-leader for non-race sessions."""
        # Parse all best lap times
        timed: list[tuple[int, float]] = []  # (index, seconds)
        for i, d in enumerate(drivers_list):
            secs = self._parse_best_lap_seconds(d.get("best_lap_time"))
            if secs is not None:
                timed.append((i, secs))

        if not timed:
            return

        # Sort by time to find leader
        timed.sort(key=lambda x: x[1])
        leader_time = timed[0][1]

        # Re-sort drivers by best lap time (position), assign gap
        for rank, (idx, secs) in enumerate(timed):
            d = drivers_list[idx]
            d["position"] = rank + 1
            if rank == 0:
                d["gap"] = self._format_lap_time(secs)
            else:
                d["gap"] = f"+{secs - leader_time:.3f}"

        # Re-sort the list by position
        drivers_list.sort(key=lambda d: d["position"] if d["position"] is not None else 9999)

    # ------------------------------------------------------------------
    # Pit prediction (mirrors replay.py logic)
    # ------------------------------------------------------------------

    def _add_pit_predictions(self, frame: dict) -> None:
        """Add pit_prediction, pit_prediction_margin, and pit_prediction_free_air
        to each driver in the frame."""
        drivers = frame.get("drivers", [])
        status = frame.get("status", "green")
        lap = frame.get("lap", 0)

        # Don't show before lap 5
        if lap < 5:
            return

        # Select pit loss based on track status
        if status == "sc":
            pit_loss = self._pit_loss_sc
        elif status == "vsc":
            pit_loss = self._pit_loss_vsc
        else:
            pit_loss = self._pit_loss_green

        # Build list of (driver_abbr, gap_seconds) for drivers on track
        driver_gaps: list[tuple[str, float]] = []
        for d in drivers:
            if d.get("retired") or d.get("in_pit"):
                continue
            if d.get("position") == 1:
                driver_gaps.append((d["abbr"], 0.0))
            else:
                gap_sec = _parse_gap_seconds(d.get("gap"))
                if gap_sec is not None:
                    driver_gaps.append((d["abbr"], gap_sec))

        if not driver_gaps:
            return

        # Sort by gap (ascending = leader first)
        driver_gaps.sort(key=lambda x: x[1])

        for d in drivers:
            if d.get("retired") or d.get("in_pit"):
                d["pit_prediction"] = None
                d["pit_prediction_margin"] = None
                d["pit_prediction_free_air"] = None
                continue

            current_gap: float | None = None
            if d.get("position") == 1:
                current_gap = 0.0
            else:
                current_gap = _parse_gap_seconds(d.get("gap"))

            if current_gap is None:
                d["pit_prediction"] = None
                d["pit_prediction_margin"] = None
                d["pit_prediction_free_air"] = None
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
                behind_idx = predicted_pos - 1
                if behind_idx < len(other_gaps):
                    margin = other_gaps[behind_idx] - projected_gap
                    d["pit_prediction_margin"] = round(max(0.0, margin), 3)
                else:
                    d["pit_prediction_margin"] = None
                # Free air — gap to the car one position ahead
                ahead_idx = predicted_pos - 2
                if ahead_idx >= 0:
                    free_air = projected_gap - other_gaps[ahead_idx]
                    d["pit_prediction_free_air"] = round(max(0.0, free_air), 1)
                else:
                    d["pit_prediction_free_air"] = None
            else:
                d["pit_prediction"] = None
                d["pit_prediction_margin"] = None
                d["pit_prediction_free_air"] = None
