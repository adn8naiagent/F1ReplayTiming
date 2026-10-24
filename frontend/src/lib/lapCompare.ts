// Lap telemetry for Lap Analysis: loading a lap's stored trace, the time gap
// along the lap between two laps, and track dominance.

import { apiFetch } from "./api";

export interface LapTelemetry {
  driver: string;
  lap: number;
  distance: number[]; // metres from the line
  speed: number[]; // km/h
  throttle: number[]; // 0–100
  brake: number[]; // 0 or 100
  gear: number[];
  rpm: number[];
  drs?: number[];
  relative_distance?: number[];
}

const cache = new Map<string, Promise<LapTelemetry>>();

/** One lap's telemetry, cached for the page's lifetime. */
export function fetchLapTelemetry(
  year: number, round: number, type: string, driver: string, lap: number,
): Promise<LapTelemetry> {
  const key = `${year}/${round}/${type}/${driver}/${lap}`;
  let p = cache.get(key);
  if (!p) {
    p = apiFetch<LapTelemetry>(
      `/api/sessions/${year}/${round}/telemetry?type=${type}&driver=${driver}&lap=${lap}`,
    );
    p.catch(() => cache.delete(key)); // don't cache failures
    cache.set(key, p);
  }
  return p;
}

/**
 * Elapsed time at each sample, from integrating distance over speed, then
 * scaled so the lap adds up to its official time. Telemetry is sampled, so
 * this is an approximation.
 */
function elapsedTimes(tel: LapTelemetry, lapSecs: number | null): number[] {
  const t = [0];
  for (let i = 1; i < tel.distance.length; i++) {
    const dd = Math.max(0, tel.distance[i] - tel.distance[i - 1]);
    const v = Math.max(1, (tel.speed[i] + tel.speed[i - 1]) / 2 / 3.6); // m/s
    t.push(t[i - 1] + dd / v);
  }
  const total = t[t.length - 1];
  if (lapSecs && total > 0) {
    const k = lapSecs / total;
    for (let i = 0; i < t.length; i++) t[i] *= k;
  }
  return t;
}

/** Linear interpolation of ys over sorted xs. */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

export interface TracePoint {
  d: number; // metres
  speedA: number;
  speedB: number;
  throttleA: number;
  throttleB: number;
  brakeA: number;
  brakeB: number;
  gearA: number;
  gearB: number;
  /** A's time minus B's so far: negative = A ahead */
  delta: number;
}

export interface LapComparison {
  points: TracePoint[];
  /** Dominance chunks as fractions of the lap, coloured by who was faster */
  chunks: { from: number; to: number; faster: "A" | "B" }[];
  chunksWonA: number;
  chunksWonB: number;
}

const GRID_M = 10;
export const DOMINANCE_CHUNKS = 25;

/** Both laps on a common distance grid, with the running gap and dominance. */
export function compareLaps(
  a: LapTelemetry, b: LapTelemetry, lapSecsA: number | null, lapSecsB: number | null,
): LapComparison {
  const tA = elapsedTimes(a, lapSecsA);
  const tB = elapsedTimes(b, lapSecsB);
  const length = Math.min(a.distance[a.distance.length - 1], b.distance[b.distance.length - 1]);
  const points: TracePoint[] = [];
  for (let d = 0; d <= length; d += GRID_M) {
    points.push({
      d,
      speedA: interp(a.distance, a.speed, d),
      speedB: interp(b.distance, b.speed, d),
      throttleA: interp(a.distance, a.throttle, d),
      throttleB: interp(b.distance, b.throttle, d),
      brakeA: interp(a.distance, a.brake, d) > 50 ? 1 : 0,
      brakeB: interp(b.distance, b.brake, d) > 50 ? 1 : 0,
      gearA: Math.round(interp(a.distance, a.gear, d)),
      gearB: Math.round(interp(b.distance, b.gear, d)),
      delta: interp(a.distance, tA, d) - interp(b.distance, tB, d),
    });
  }

  const chunks: LapComparison["chunks"] = [];
  let wonA = 0;
  for (let i = 0; i < DOMINANCE_CHUNKS; i++) {
    const d0 = (length * i) / DOMINANCE_CHUNKS;
    const d1 = (length * (i + 1)) / DOMINANCE_CHUNKS;
    const timeA = interp(a.distance, tA, d1) - interp(a.distance, tA, d0);
    const timeB = interp(b.distance, tB, d1) - interp(b.distance, tB, d0);
    const faster = timeA <= timeB ? "A" : "B";
    if (faster === "A") wonA++;
    chunks.push({ from: i / DOMINANCE_CHUNKS, to: (i + 1) / DOMINANCE_CHUNKS, faster });
  }
  return { points, chunks, chunksWonA: wonA, chunksWonB: DOMINANCE_CHUNKS - wonA };
}
