// Shared lap-timing display logic used by both the leaderboard timing tower
// and the qualifying lap-completion bubbles, so the two never diverge.

import type { LapEntry } from "@/components/Leaderboard";

export type SectorColor = "purple" | "green" | "yellow";
export interface SectorInfo {
  num: number;
  color: SectorColor;
}

export type LapData = Map<string, Map<number, { time: string; completedAt: number | null; sectors?: (string | null)[] }>>;

/** driver -> lap number -> lap time, from the laps list (replays or live). */
export function buildLapData(laps: LapEntry[]): LapData {
  const map: LapData = new Map();
  for (const lap of laps) {
    if (!lap.lap_time) continue;
    let driverMap = map.get(lap.driver);
    if (!driverMap) {
      driverMap = new Map();
      map.set(lap.driver, driverMap);
    }
    driverMap.set(lap.lap_number, {
      time: lap.lap_time,
      completedAt: lap.time ?? null,
      sectors: [lap.sector1 ?? null, lap.sector2 ?? null, lap.sector3 ?? null],
    });
  }
  return map;
}

// Parse a lap time string ("1:34.567" or "94.567") into seconds.
export function toSecs(t: string): number {
  const p = t.split(":");
  return p.length === 2 ? parseInt(p[0]) * 60 + parseFloat(p[1]) : parseFloat(p[0]) || Infinity;
}

// Returns the tailwind text-colour class for a lap time, matching the timing
// tower exactly: purple = fastest overall, green = personal best, grey = other.
export function lapColorClass(
  lapTime: string,
  abbr: string,
  lapData: LapData | undefined,
  currentTime: number,
  currentLap: number,
  isRace: boolean,
  hasFastestLap: boolean,
): string {
  const driverLaps = lapData?.get(abbr);
  const lastSecs = toSecs(lapTime);

  // Check personal best (this driver's completed laps up to now)
  let personalBest = Infinity;
  if (driverLaps) {
    for (const [lapNum, entry] of driverLaps) {
      if (lapNum < 2) continue;
      if (!isRace && entry.completedAt !== null && entry.completedAt > currentTime) continue;
      if (isRace && lapNum > (currentLap || 0)) continue;
      const s = toSecs(entry.time);
      if (s < personalBest) personalBest = s;
    }
  }
  const isPersonalBest = lastSecs <= personalBest + 0.0005;

  // Purple: for races, use backend flag. For practice/qualifying, compute from all drivers' laps.
  let isFastest = false;
  if (isRace) {
    isFastest = hasFastestLap && isPersonalBest;
  } else if (isPersonalBest && lapData) {
    let overallFastest = Infinity;
    for (const [, laps] of lapData) {
      for (const [lapNum, entry] of laps) {
        if (lapNum < 2) continue;
        if (entry.completedAt !== null && entry.completedAt > currentTime) continue;
        const s = toSecs(entry.time);
        if (s < overallFastest) overallFastest = s;
      }
    }
    isFastest = lastSecs <= overallFastest + 0.0005;
  }

  return isFastest ? "text-purple-400" : isPersonalBest ? "text-green-400" : "text-f1-muted";
}

// The three sector squares, rendered identically to the leaderboard. The
// `className` styles the wrapper (width/margins) so callers can size it.
export function SectorMarkers({ sectors, className = "" }: { sectors?: SectorInfo[] | null; className?: string }) {
  return (
    <span className={`flex items-center justify-center gap-[2px] ${className}`}>
      {[1, 2, 3].map((sn) => {
        const sec = sectors?.find((s) => s.num === sn);
        const bg = sec
          ? sec.color === "purple" ? "bg-purple-500"
          : sec.color === "green" ? "bg-green-500"
          : "bg-yellow-500"
          : "bg-white/15";
        return <span key={sn} className={`w-[6px] h-[14px] rounded-[1px] ${bg}`} />;
      })}
    </span>
  );
}
