// Sector and lap maths for Lap Analysis (qualifying, sprint qualifying and
// practice). Follows the backend's rules for the timing tower's sector
// colours (f1_data.py): out laps don't count, and purple/green use a 0.0005s
// tolerance. Deleted laps (stewards' decisions) don't count either. Sessions
// processed with sector end times count each sector as soon as it's set, like
// the tower; older ones only once the lap completes.

import type { LapEntry } from "@/components/Leaderboard";
import { toSecs } from "./lapTiming";

export type LapKind = "out" | "in" | "push";

export interface ParsedLap {
  driver: string;
  lapNumber: number;
  lapTime: string | null;
  lapSecs: number | null;
  /** S1–S3 in seconds */
  sectors: [number | null, number | null, number | null];
  kind: LapKind;
  /** Replay seconds when the lap completed */
  completedAt: number | null;
  /** When each sector ended (replay seconds), if known */
  sectorEnds: [number | null, number | null, number | null];
  /** Lap time deleted by the stewards */
  deleted: boolean;
  deletedReason: string | null;
  compound: string | null;
  tyreLife: number | null;
}

export interface SectorBest {
  secs: number;
  driver: string;
  lapNumber: number;
}

export interface SessionBests {
  /** Fastest of each sector so far, with who set it */
  sectors: [SectorBest | null, SectorBest | null, SectorBest | null];
  /** Each driver's best of each sector so far */
  personalSectors: Map<string, [number | null, number | null, number | null]>;
  /** Each driver's best lap so far */
  personalLap: Map<string, { secs: number; lapNumber: number }>;
  /** Fastest lap so far */
  lap: SectorBest | null;
}

const TOLERANCE = 0.0005;

function secsOrNull(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = toSecs(t);
  return Number.isFinite(s) ? s : null;
}

/** Out = lap 1 or a lap starting from the pits; in = a lap ending in the pits. */
export function classifyLap(lap: LapEntry): LapKind {
  if (lap.lap_number === 1 || lap.pit_out) return "out";
  if (lap.pit_in) return "in";
  return "push";
}

/** Each driver's laps, parsed once and sorted by lap number. */
export function parseLaps(laps: LapEntry[]): Map<string, ParsedLap[]> {
  const map = new Map<string, ParsedLap[]>();
  for (const lap of laps) {
    const parsed: ParsedLap = {
      driver: lap.driver,
      lapNumber: lap.lap_number,
      lapTime: lap.lap_time,
      lapSecs: secsOrNull(lap.lap_time),
      sectors: [secsOrNull(lap.sector1), secsOrNull(lap.sector2), secsOrNull(lap.sector3)],
      kind: classifyLap(lap),
      completedAt: lap.time ?? null,
      sectorEnds: [lap.s1_end ?? null, lap.s2_end ?? null, lap.time ?? null],
      deleted: !!lap.deleted,
      deletedReason: lap.deleted_reason ?? null,
      compound: lap.compound,
      tyreLife: lap.tyre_life ?? null,
    };
    const arr = map.get(lap.driver);
    if (arr) arr.push(parsed);
    else map.set(lap.driver, [parsed]);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.lapNumber - b.lapNumber);
  return map;
}

/** Whether a lap had completed by replay time t. */
export function isComplete(lap: ParsedLap, t: number): boolean {
  return lap.completedAt !== null && lap.completedAt <= t;
}

/** Bests as of replay time t, counting completed laps that aren't out laps. */
export function computeSessionBests(driverLaps: Map<string, ParsedLap[]>, t: number): SessionBests {
  const bests: SessionBests = {
    sectors: [null, null, null],
    personalSectors: new Map(),
    personalLap: new Map(),
    lap: null,
  };
  for (const [driver, laps] of driverLaps) {
    const personal: [number | null, number | null, number | null] = [null, null, null];
    for (const lap of laps) {
      if (lap.kind === "out" || lap.deleted) continue;
      lap.sectors.forEach((s, i) => {
        if (s === null) return;
        // Counted once that sector has been set (its end time, else the lap's)
        const end = lap.sectorEnds[i] ?? lap.completedAt;
        if (end === null || end > t) return;
        if (personal[i] === null || s < personal[i]!) personal[i] = s;
        const overall = bests.sectors[i];
        if (!overall || s < overall.secs) bests.sectors[i] = { secs: s, driver, lapNumber: lap.lapNumber };
      });
      if (lap.lapSecs !== null && isComplete(lap, t)) {
        const pb = bests.personalLap.get(driver);
        if (!pb || lap.lapSecs < pb.secs) bests.personalLap.set(driver, { secs: lap.lapSecs, lapNumber: lap.lapNumber });
        if (!bests.lap || lap.lapSecs < bests.lap.secs) bests.lap = { secs: lap.lapSecs, driver, lapNumber: lap.lapNumber };
      }
    }
    bests.personalSectors.set(driver, personal);
  }
  return bests;
}

/** Purple = session best so far, green = the driver's best so far. */
export function sectorColor(
  secs: number | null,
  driver: string,
  index: number,
  bests: SessionBests,
): "purple" | "green" | null {
  if (secs === null) return null;
  const overall = bests.sectors[index];
  if (overall && secs <= overall.secs + TOLERANCE) return "purple";
  const personal = bests.personalSectors.get(driver)?.[index];
  if (personal != null && secs <= personal + TOLERANCE) return "green";
  return null;
}

/** Sum of a driver's best sectors, if they have all three. */
export function idealLap(driver: string, bests: SessionBests): number | null {
  const s = bests.personalSectors.get(driver);
  if (!s || s.some((v) => v === null)) return null;
  return s[0]! + s[1]! + s[2]!;
}

/** Fastest possible lap from the session's best sectors. */
export function theoreticalBest(bests: SessionBests): number | null {
  if (bests.sectors.some((s) => s === null)) return null;
  return bests.sectors.reduce((sum, s) => sum + s!.secs, 0);
}

export function formatLapSecs(secs: number): string {
  const mins = Math.floor(secs / 60);
  const rest = secs - mins * 60;
  return mins > 0 ? `${mins}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

/** "+0.123" / "-0.045" / "0.000" */
export function formatDelta(delta: number): string {
  const sign = delta > 0.0005 ? "+" : delta < -0.0005 ? "-" : "";
  return `${sign}${Math.abs(delta).toFixed(3)}`;
}

export const SECTOR_COLOR_CLASS = { purple: "text-purple-400", green: "text-green-400" } as const;
