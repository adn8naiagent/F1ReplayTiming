// Lap telemetry for Lap Analysis: loading a lap's stored trace, the time gap
// along the lap between two laps, and track dominance.

import { apiFetch } from "./api";
import { lapFractions, type SegmentOverlay } from "./trackRenderer";

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

const GRID_POINTS = 500;
export const DOMINANCE_CHUNKS = 25;

/** Each sample's position as a fraction of the lap's measured length. */
function fractions(tel: LapTelemetry): number[] {
  const total = tel.distance[tel.distance.length - 1] || 1;
  return tel.distance.map((d) => d / total);
}

/**
 * Both laps on a common grid, with the running gap and dominance. Laps are
 * matched by fraction of the lap rather than metres: the measured lap length
 * differs by a few tens of metres between cars, which would otherwise build
 * into a gap that doesn't match the lap times.
 */
export function compareLaps(
  a: LapTelemetry, b: LapTelemetry, lapSecsA: number | null, lapSecsB: number | null,
): LapComparison {
  const tA = elapsedTimes(a, lapSecsA);
  const tB = elapsedTimes(b, lapSecsB);
  const fA = fractions(a);
  const fB = fractions(b);
  const length = a.distance[a.distance.length - 1]; // for the distance axis
  const points: TracePoint[] = [];
  for (let i = 0; i <= GRID_POINTS; i++) {
    const f = i / GRID_POINTS;
    points.push({
      d: f * length,
      speedA: interp(fA, a.speed, f),
      speedB: interp(fB, b.speed, f),
      throttleA: interp(fA, a.throttle, f),
      throttleB: interp(fB, b.throttle, f),
      brakeA: interp(fA, a.brake, f) > 50 ? 1 : 0,
      brakeB: interp(fB, b.brake, f) > 50 ? 1 : 0,
      gearA: Math.round(interp(fA, a.gear, f)),
      gearB: Math.round(interp(fB, b.gear, f)),
      delta: interp(fA, tA, f) - interp(fB, tB, f),
    });
  }

  const chunks: LapComparison["chunks"] = [];
  let wonA = 0;
  for (let i = 0; i < DOMINANCE_CHUNKS; i++) {
    const f0 = i / DOMINANCE_CHUNKS;
    const f1 = (i + 1) / DOMINANCE_CHUNKS;
    const timeA = interp(fA, tA, f1) - interp(fA, tA, f0);
    const timeB = interp(fB, tB, f1) - interp(fB, tB, f0);
    const faster = timeA <= timeB ? "A" : "B";
    if (faster === "A") wonA++;
    chunks.push({ from: f0, to: f1, faster });
  }
  return { points, chunks, chunksWonA: wonA, chunksWonB: DOMINANCE_CHUNKS - wonA };
}

/** Track dominance for the track map, with a legend of chunks won. */
export interface DominanceOverlay extends SegmentOverlay {
  legend: { abbr: string; color: string; count: number }[];
}

export function dominanceOverlay(
  c: LapComparison, abbrA: string, abbrB: string, colorA: string, colorB: string,
): DominanceOverlay {
  return {
    segments: c.chunks.map((ch) => ({ from: ch.from, to: ch.to, color: ch.faster === "A" ? colorA : colorB })),
    legend: [
      { abbr: abbrA, color: colorA, count: c.chunksWonA },
      { abbr: abbrB, color: colorB, count: c.chunksWonB },
    ],
  };
}

/** Each corner's position along the lap (0–1): the nearest outline point. */
export function cornerFractions(
  outline: { x: number; y: number }[],
  corners: { x: number; y: number; number: number; letter?: string }[],
): { frac: number; label: string }[] {
  if (outline.length < 2) return [];
  const frac = lapFractions(outline);
  return corners
    .map((c) => {
      let best = 0;
      let bestD = Infinity;
      outline.forEach((p, i) => {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      return { frac: frac[best], label: `${c.number}${c.letter ?? ""}` };
    })
    .sort((a, b) => a.frac - b.frac);
}
