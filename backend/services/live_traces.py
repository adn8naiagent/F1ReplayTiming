"""Each lap's telemetry trace in live timing, for Lap Analysis's Compare tab
and track dominance (qualifying and practice).

Replays load a lap's trace from the processed session. Live timing records
one instead: every car data sample (speed, throttle, brake, gear, RPM, DRS),
cut into laps where the car crosses the line. The crossing comes from car
positions (both feeds carry UTC times), so a lap's trace starts and ends at
the line rather than when the timing message arrived. Distance is the
integral of speed, as FastF1 does.

Traces come out in the replay's format (routers/telemetry.py), so the
frontend compares them unchanged.
"""

from __future__ import annotations

from collections import deque
from typing import Any

import numpy as np

# Car data arrives about 4 times a second
_MAX_SAMPLES = 3000  # per car, about 12 minutes
_MAX_TRACES = 60  # per car
_MIN_LAP_S = 30.0
# Wait for car data this far past the line before cutting a lap (it arrives
# in batches)
_SETTLE_S = 2.0


class LapTraceRecorder:
    def __init__(self) -> None:
        # number -> (utc, speed, throttle, brake, gear, rpm, drs)
        self._samples: dict[str, deque[tuple[float, ...]]] = {}
        self._crossings: dict[str, deque[float]] = {}  # number -> UTC at the line
        self._last_pos: dict[str, tuple[float, float]] = {}  # number -> (utc, lap fraction)
        self._pending: list[tuple[str, int, float]] = []  # (number, lap number, estimated end UTC)
        self._traces: dict[tuple[str, int], dict[str, Any]] = {}
        self._newest_utc = 0.0

    # --- Feed hooks ---------------------------------------------------

    def car_data(self, number: str, utc: float, speed, throttle, brake, gear, rpm, drs) -> None:
        def num(v, cap=None):
            try:
                v = float(v)
            except (TypeError, ValueError):
                return 0.0
            # Above 100 is F1's "no data" for throttle and brake
            return 0.0 if cap is not None and v > cap else v

        buf = self._samples.setdefault(number, deque(maxlen=_MAX_SAMPLES))
        if buf and utc <= buf[-1][0]:
            return
        buf.append((utc, num(speed), num(throttle, 100), 100.0 if num(brake, 100) > 0 else 0.0,
                    num(gear), num(rpm), num(drs)))
        self._newest_utc = max(self._newest_utc, utc)
        # Cut laps as soon as their data is in, not just at the next frame:
        # skipping forward replays minutes of data at once
        if self._pending and self._newest_utc >= self._pending[0][2] + _SETTLE_S:
            self.process()

    def position(self, number: str, utc: float, frac: float) -> None:
        """A position sample, as a fraction of the lap. Going from near 1 to
        near 0 is crossing the line."""
        prev = self._last_pos.get(number)
        self._last_pos[number] = (utc, frac)
        if prev is None:
            return
        t0, f0 = prev
        if f0 > 0.75 and frac < 0.25 and 0 < utc - t0 < 5:
            # Interpolate where between the two samples the line was
            span = (frac + 1.0) - f0
            t = t0 + (1.0 - f0) / span * (utc - t0) if span > 0 else utc
            self._crossings.setdefault(number, deque(maxlen=200)).append(t)

    def lap_completed(self, number: str, lap_number: int, end_utc: float) -> None:
        self._pending.append((number, lap_number, end_utc))

    # --- Building traces ----------------------------------------------

    def process(self) -> None:
        """Cut pending laps once their car data has arrived."""
        still = []
        for number, lap_number, end_est in self._pending:
            if self._newest_utc < end_est + _SETTLE_S:
                still.append((number, lap_number, end_est))
                continue
            trace = self._build(number, lap_number, end_est)
            if trace is not None:
                self._traces[(number, lap_number)] = trace
                own = sorted(k for k in self._traces if k[0] == number)
                for k in own[:-_MAX_TRACES]:
                    del self._traces[k]
        self._pending = still

    def _build(self, number: str, lap_number: int, end_est: float) -> dict[str, Any] | None:
        crossings = list(self._crossings.get(number, ()))
        # The line crossing nearest the lap's completion, then the one before
        near = [c for c in crossings if end_est - 6.0 <= c <= end_est + 3.0]
        if not near:
            return None
        end = min(near, key=lambda c: abs(c - end_est))
        before = [c for c in crossings if c < end - _MIN_LAP_S]
        if not before:
            return None
        start = before[-1]
        rows = [s for s in self._samples.get(number, ()) if start <= s[0] <= end]
        if len(rows) < 20:
            return None
        a = np.array(rows, dtype=np.float64)
        t, speed = a[:, 0], a[:, 1]
        # Distance from the line: speed integrated over time
        dt = np.diff(t)
        dist = np.concatenate([[0.0], np.cumsum((speed[1:] + speed[:-1]) / 2 / 3.6 * dt)])
        total = dist[-1] or 1.0
        return {
            "lap": lap_number,
            "distance": np.round(dist, 1).tolist(),
            "relative_distance": np.round(dist / total, 5).tolist(),
            "speed": np.round(speed, 1).tolist(),
            "throttle": np.round(a[:, 2], 1).tolist(),
            "brake": a[:, 3].tolist(),
            "gear": a[:, 4].astype(int).tolist(),
            "rpm": np.round(a[:, 5]).tolist(),
            "drs": a[:, 6].astype(int).tolist(),
        }

    def get(self, number: str, lap_number: int) -> dict[str, Any] | None:
        self.process()
        return self._traces.get((number, lap_number))
