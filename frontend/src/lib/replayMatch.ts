// Finds the replay frame that best matches a leaderboard read from the TV
// (typed in, or extracted from a photo). Mirrors _match_frame in
// backend/routers/sync.py, so both players sync to the same moment.

import type { ReplayFrame } from "@/hooks/useReplaySocket";

export interface ExtractedLeaderboard {
  lap: number;
  drivers: Array<{ position: number; abbr: string; gap: string | null; tyre?: string | null }>;
}

export interface MatchResult {
  timestamp: number;
  lap: number;
  confidence: number;
  extracted: ExtractedLeaderboard;
}

function parseGap(gap: string | null | undefined): number | null {
  if (gap == null) return null;
  const lapped = gap.match(/^(\d+)\s*LAPS?$/i);
  if (lapped) return 9000 + Number(lapped[1]);
  const n = Number(gap.replace(/^\+/, ""));
  return Number.isFinite(n) && gap.trim() !== "" ? n : null;
}

export function matchFrame(frames: ReplayFrame[], extracted: ExtractedLeaderboard): MatchResult {
  const targetLap = extracted.lap || 1;
  const drivers = extracted.drivers || [];
  if (drivers.length === 0) throw new Error("No drivers to match");
  if (frames.length === 0) throw new Error("No replay data available");

  const targetGaps = new Map<string, number>();
  for (const d of drivers) {
    if (d.position === 1) targetGaps.set(d.abbr, 0);
    else {
      const g = parseGap(d.gap);
      if (g !== null) targetGaps.set(d.abbr, g);
    }
  }
  const targetOrder = drivers.map((d) => d.abbr);

  let candidates = frames.filter((f) => Math.abs((f.lap || 0) - targetLap) <= 1);
  if (candidates.length === 0) candidates = frames;

  let best = candidates[0];
  let bestScore = Infinity;

  for (const frame of candidates) {
    const byAbbr = new Map(frame.drivers.map((d) => [d.abbr, d]));
    let score = 0;

    targetGaps.forEach((targetGap, abbr) => {
      const fd = byAbbr.get(abbr);
      if (!fd || !fd.gap) {
        score += 50;
        return;
      }
      let frameGap: number;
      if (fd.gap.startsWith("LAP")) frameGap = 0;
      else {
        const fg = parseGap(fd.gap);
        if (fg === null) {
          score += 20;
          return;
        }
        frameGap = fg;
      }
      score += Math.abs(frameGap - targetGap);
    });

    const frameOrder = [...frame.drivers]
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
      .map((d) => d.abbr);
    targetOrder.forEach((abbr, i) => {
      const fi = frameOrder.indexOf(abbr);
      if (fi >= 0) score += Math.abs(fi - i) * 2;
    });

    if (frame.lap !== targetLap) score += 10;

    if (score < bestScore) {
      bestScore = score;
      best = frame;
    }
  }

  return {
    timestamp: best.timestamp,
    lap: best.lap || 0,
    confidence: Math.max(0, 100 - bestScore),
    extracted,
  };
}
