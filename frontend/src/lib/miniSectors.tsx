// Mini-sectors: F1's per-loop colours within each sector (qualifying,
// sprint qualifying and practice). Data from minisectors.json; see
// backend/services/minisectors.py.

export interface MiniSectorData {
  counts: number[]; // per sector, e.g. [8, 8, 8]
  ends: number[]; // each mini-sector's end, 0–1 along the lap
  /** [t, sector, index, status]; sector -1 clears all */
  drivers: Record<string, [number, number, number, number][]>;
}

export const MINI_PURPLE = 2051;
export const MINI_GREEN = 2049;
export const MINI_YELLOW = 2048;
export const MINI_PIT = 2064;

export const MINI_HEX: Record<number, string> = {
  [MINI_PURPLE]: "#A855F7",
  [MINI_GREEN]: "#22C55E",
  [MINI_YELLOW]: "#EAB308",
};

const MINI_BG: Record<number, string> = {
  [MINI_PURPLE]: "bg-purple-500",
  [MINI_GREEN]: "bg-green-500",
  [MINI_YELLOW]: "bg-yellow-500",
  [MINI_PIT]: "bg-white/35",
};

interface DriverIndex {
  times: number[];
  /** Index of the last clear at or before each event, or -1 */
  lastClear: number[];
}

const indexCache = new WeakMap<MiniSectorData, Map<string, DriverIndex>>();

function driverIndex(data: MiniSectorData, abbr: string): DriverIndex | null {
  let byDriver = indexCache.get(data);
  if (!byDriver) {
    byDriver = new Map();
    indexCache.set(data, byDriver);
  }
  let idx = byDriver.get(abbr);
  if (!idx) {
    const events = data.drivers[abbr];
    if (!events) return null;
    let clear = -1;
    idx = {
      times: events.map((e) => e[0]),
      lastClear: events.map((e, i) => (e[1] === -1 ? (clear = i) : clear)),
    };
    byDriver.set(abbr, idx);
  }
  return idx;
}

/** A driver's mini-sector statuses at replay time t, flat in lap order (0 = not yet). */
export function miniStatesAt(data: MiniSectorData, abbr: string, t: number): number[] | null {
  const idx = driverIndex(data, abbr);
  if (!idx) return null;
  const events = data.drivers[abbr];
  const total = data.counts.reduce((a, b) => a + b, 0);
  const offsets = data.counts.map((_, s) => data.counts.slice(0, s).reduce((a, b) => a + b, 0));
  const states = new Array<number>(total).fill(0);
  // Last event at or before t
  let lo = 0;
  let hi = idx.times.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.times[mid] <= t) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (last < 0) return states;
  for (let i = Math.max(0, idx.lastClear[last] + 1); i <= last; i++) {
    const [, s, g, status] = events[i];
    if (s >= 0 && g < data.counts[s]) states[offsets[s] + g] = status;
  }
  return states;
}

/** One thin bar per mini-sector, in three groups, filling in as the car goes round. */
export function MiniSectorMarkers({ states, counts, className = "" }: {
  states: number[] | null;
  counts: number[];
  className?: string;
}) {
  let k = 0;
  return (
    <span className={`flex items-center justify-center gap-[3px] ${className}`}>
      {counts.map((n, s) => (
        <span key={s} className="flex items-center gap-[1px]">
          {Array.from({ length: n }, () => {
            const status = states?.[k++] ?? 0;
            return <span key={k} className={`w-[2px] h-[14px] rounded-[1px] ${MINI_BG[status] ?? "bg-white/15"}`} />;
          })}
        </span>
      ))}
    </span>
  );
}

/** Width of the markers in px, for the leaderboard's width maths. */
export function miniMarkersWidth(counts: number[]): number {
  const bars = counts.reduce((a, b) => a + b, 0);
  return bars * 3 - counts.length + (counts.length - 1) * 3;
}
