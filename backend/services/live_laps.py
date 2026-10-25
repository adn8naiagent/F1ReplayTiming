"""Lap history for live timing, built up as laps are completed.

Replays read each driver's laps from FastF1 (laps.json). Live timing has no
such list, so this records one from the timing feed: a lap is complete when
a driver's NumberOfLaps goes up, with the lap time from LastLapTime and the
sector times collected during the lap. Entries match the replay's LapEntry,
so Lap Analysis and lap notifications work on them unchanged.

Times ("time", "s1_end", "s2_end") are on the live clock, the same one as
each frame's timestamp, so the frontend filters laps by the current frame
exactly as replays do (and broadcast delay applies to both).

F1 doesn't always send a lap's last sector and lap time in the same message
as the lap count, so values arriving shortly after a lap completes are
added to that lap.

Laps completed before live timing connected aren't known.

Lap numbers follow the replays (FastF1). In practice and qualifying F1's
lap count also goes up as a car first crosses the line leaving the pit
lane, so it runs one ahead; race control's messages ("... LAP 3") use F1's
count, so deletions are matched on it.
"""

from __future__ import annotations

import re
from typing import Any

# How long after a lap completes its lap time or S3 may still arrive
_LATE_S = 5.0

# "CAR 10 (GAS) TIME 1:36.764 DELETED - TRACK LIMITS AT TURN 9 LAP 3 16:07:14"
# "CAR 5 (BOR) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 9 16:29:31 (PIT)"
_DELETED_RE = re.compile(
    r"CAR (\d+) \(\w+\) (?:TIME ([\d:.]+) |LAP )DELETED - (.+?) LAP (\d+)\b"
)
_CAR_RE = re.compile(r"CAR (\d+)")
_TIME_RE = re.compile(r"TIME (\d+:\d{2}\.\d+)")
_LAP_RE = re.compile(r"LAP (\d+)")


class _Pending:
    """The lap a driver is on."""

    __slots__ = ("sectors", "ends", "pit_in", "pit_out")

    def __init__(self, pit_out: bool = False) -> None:
        self.sectors: list[str | None] = [None, None, None]
        self.ends: list[float | None] = [None, None, None]
        self.pit_in = False
        self.pit_out = pit_out


class LapRecorder:
    def __init__(self, is_race: bool) -> None:
        # F1's lap count minus the replay's lap number
        self._count_offset = 0 if is_race else 1
        self.version = 0  # goes up whenever a lap is added or changed
        self._laps: list[dict[str, Any]] = []
        self._count: dict[str, int] = {}  # racing number -> laps completed
        self._pending: dict[str, _Pending] = {}
        self._last_lap_time: dict[str, tuple[str, float]] = {}  # number -> (value, ts)
        self._deletions: dict[tuple[str, int], str] = {}  # deleted before the lap was recorded

    # --- Feed hooks ---------------------------------------------------

    def _p(self, number: str) -> _Pending:
        if number not in self._pending:
            self._pending[number] = _Pending()
        return self._pending[number]

    def _latest(self, number: str, ts: float) -> dict[str, Any] | None:
        """The driver's most recent lap, if it completed in the last few seconds."""
        for lap in reversed(self._laps):
            if lap["racing_number"] == number:
                return lap if ts - (lap["time"] or 0) <= _LATE_S else None
        return None

    def sector(self, number: str, index: int, value: str, ts: float) -> None:
        if not value or not 0 <= index <= 2:
            return
        p = self._p(number)
        if index == 2 and p.sectors[0] is None:
            # S3 after the lap count went up: it belongs to the lap just done
            lap = self._latest(number, ts)
            if lap is not None and lap["sector3"] is None:
                lap["sector3"] = value
                self.version += 1
                return
        p.sectors[index] = value
        p.ends[index] = ts

    def lap_time(self, number: str, value: str | None, ts: float) -> None:
        if not value:
            return
        lap = self._latest(number, ts)
        if lap is not None and lap["lap_time"] is None:
            lap["lap_time"] = value
            self.version += 1
            return
        self._last_lap_time[number] = (value, ts)

    def pit_in(self, number: str) -> None:
        self._p(number).pit_in = True

    def pit_out(self, number: str) -> None:
        self._p(number).pit_out = True

    def laps_completed(
        self, number: str, count: int, ts: float, compound: str | None, tyre_life: int | None,
        baseline: bool = False,
    ) -> int | None:
        """NumberOfLaps from the feed. baseline is for the snapshot F1 sends
        on connecting: laps before then aren't known. Returns the lap number
        recorded, if any."""
        prev = self._count.get(number, 0)
        self._count[number] = count
        if baseline or count <= prev:
            return None
        lap_number = count - self._count_offset
        if lap_number < 1:  # leaving the pit lane for the first time
            self._pending[number] = _Pending(pit_out=True)
            return None
        p = self._p(number)
        llt = self._last_lap_time.get(number)
        lap_time = llt[0] if llt and ts - llt[1] <= _LATE_S else None
        lap = {
            "racing_number": number,
            "count": count,
            "lap_number": lap_number,
            "lap_time": lap_time,
            "time": ts,
            "compound": compound,
            "tyre_life": tyre_life,
            "sector1": p.sectors[0],
            "sector2": p.sectors[1],
            "sector3": p.sectors[2],
            "s1_end": p.ends[0],
            "s2_end": p.ends[1],
            "pit_in": p.pit_in,
            "pit_out": p.pit_out,
            "deleted": False,
        }
        reason = self._deletions.pop((number, count), None)
        if reason:
            lap["deleted"], lap["deleted_reason"] = True, reason
        self._laps.append(lap)
        self._pending[number] = _Pending()
        self.version += 1
        return lap_number

    def race_control(self, message: str) -> None:
        """Lap deletions (and reinstatements) by the stewards."""
        m = _DELETED_RE.search(message)
        if m:
            number, time_str, reason, lap_n = m.group(1), m.group(2), m.group(3).strip(), int(m.group(4))
            lap = self._find(number, lap_n, time_str)
            if lap is None:
                self._deletions[(number, lap_n)] = reason
            elif not lap["deleted"]:
                lap["deleted"], lap["deleted_reason"] = True, reason
                self.version += 1
            return
        car = _CAR_RE.search(message)
        if "REINSTATED" in message and car:
            lap_m, time_m = _LAP_RE.search(message), _TIME_RE.search(message)
            lap = self._find(car.group(1), int(lap_m.group(1)) if lap_m else None, time_m.group(1) if time_m else None)
            if lap is not None and lap["deleted"]:
                lap["deleted"] = False
                lap.pop("deleted_reason", None)
                self.version += 1

    def _find(self, number: str, lap_n: int | None, time_str: str | None) -> dict[str, Any] | None:
        for lap in reversed(self._laps):
            if lap["racing_number"] != number:
                continue
            if lap_n is not None and lap["count"] == lap_n:
                return lap
            if lap_n is None and time_str and lap["lap_time"] == time_str:
                return lap
        return None

    # --- Output -------------------------------------------------------

    def entries(self, abbr_of: dict[str, str]) -> list[dict[str, Any]]:
        """Laps as the frontend's LapEntry, for drivers with a known code."""
        out = []
        for lap in self._laps:
            abbr = abbr_of.get(lap["racing_number"])
            if not abbr:
                continue
            entry = {k: v for k, v in lap.items() if k not in ("racing_number", "count")}
            entry["driver"] = abbr
            out.append(entry)
        return out
