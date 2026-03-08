"use client";

import { useState, useRef, useEffect } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";
import { ReplaySettings } from "@/hooks/useSettings";
import { TYRE_COLORS, TYRE_SHORT, TEAM_ABBR } from "@/lib/constants";

interface Props {
  drivers: ReplayDriver[];
  highlightedDrivers: string[];
  onDriverClick: (abbr: string) => void;
  settings: ReplaySettings;
  currentTime: number;
  isRace: boolean;
}

function formatGap(gap: string | null): string {
  if (!gap) return "";
  const match = gap.match(/^(\d+)\s*L$/);
  if (match) {
    const n = parseInt(match[1]);
    return `+${n} Lap${n > 1 ? "s" : ""}`;
  }
  return gap;
}

function parseGapSeconds(gap: string | null): number | null {
  if (!gap) return null;
  if (gap.startsWith("LAP")) return 0;
  const lapped = gap.match(/^(\d+)\s*L$/);
  if (lapped) return null; // can't compute interval for lapped cars
  try {
    return parseFloat(gap.replace("+", ""));
  } catch {
    return null;
  }
}

function computeIntervals(sorted: ReplayDriver[]): Map<string, string> {
  const intervals = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const drv = sorted[i];
    if (i === 0) {
      intervals.set(drv.abbr, "Leader");
      continue;
    }
    const currGap = parseGapSeconds(drv.gap);
    const prevGap = parseGapSeconds(sorted[i - 1].gap);
    // Lapped cars: show laps behind
    const lapped = drv.gap?.match(/^(\d+)\s*L$/);
    if (lapped) {
      const prevLapped = sorted[i - 1].gap?.match(/^(\d+)\s*L$/);
      if (prevLapped) {
        const diff = parseInt(lapped[1]) - parseInt(prevLapped[1]);
        if (diff > 0) {
          intervals.set(drv.abbr, `+${diff} Lap${diff > 1 ? "s" : ""}`);
        } else {
          intervals.set(drv.abbr, "+0.000");
        }
      } else {
        intervals.set(drv.abbr, `+${lapped[1]} Lap${parseInt(lapped[1]) > 1 ? "s" : ""}`);
      }
      continue;
    }
    if (currGap !== null && prevGap !== null) {
      const diff = currGap - prevGap;
      intervals.set(drv.abbr, `+${diff.toFixed(3)}`);
    } else {
      intervals.set(drv.abbr, formatGap(drv.gap));
    }
  }
  return intervals;
}

export default function Leaderboard({ drivers, highlightedDrivers, onDriverClick, settings, currentTime, isRace }: Props) {
  const [showInterval, setShowInterval] = useState(true);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updateScale() {
      if (!containerRef.current || !contentRef.current) return;
      // On mobile (< 640px), don't scale - let it scroll instead
      if (window.innerWidth < 640) {
        setScale(1);
        return;
      }
      const containerH = containerRef.current.clientHeight;
      const contentH = contentRef.current.scrollHeight;
      if (contentH > containerH && contentH > 0) {
        setScale(Math.max(0.55, containerH / contentH));
      } else {
        setScale(1);
      }
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [drivers.length, settings.showGapToLeader, isRace]);

  const sorted = [...drivers].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );

  const intervals = isRace && showInterval ? computeIntervals(sorted) : null;

  return (
    <div ref={containerRef} className="bg-f1-card border-f1-border h-full overflow-y-auto sm:overflow-hidden">
      <div ref={contentRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${100 / scale}%` }}>
      {/* Interval / Leader toggle - race only */}
      {isRace && settings.showGapToLeader && (
        <div className="flex border-b border-f1-border/50">
          <button
            onClick={() => setShowInterval(true)}
            className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              showInterval ? "text-white bg-white/5" : "text-f1-muted hover:text-white"
            }`}
          >
            Interval
          </button>
          <button
            onClick={() => setShowInterval(false)}
            className={`flex-1 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              !showInterval ? "text-white bg-white/5" : "text-f1-muted hover:text-white"
            }`}
          >
            Leader
          </button>
        </div>
      )}

      <div className="divide-y divide-f1-border/50">
        {sorted.map((drv) => {
          const isHighlighted = highlightedDrivers.includes(drv.abbr);
          const isLeader = drv.position === 1;
          const compound = drv.compound;
          const tyreColor = compound ? (TYRE_COLORS[compound] || "#888") : undefined;
          const tyreLabel = compound ? (TYRE_SHORT[compound] || "?") : null;

          const displayGap = (() => {
            if (drv.retired) return "Out";
            if (drv.in_pit && isRace) return "PIT";
            if (isRace && drv.position === 1) return showInterval ? "Interval" : "Leader";
            if (drv.gap === "No time") return "No time";
            if (isRace && intervals) {
              return intervals.get(drv.abbr) || formatGap(drv.gap);
            }
            return formatGap(drv.gap);
          })();

          return (
            <button
              key={drv.abbr}
              onClick={() => onDriverClick(drv.abbr)}
              className={`w-full flex items-center px-2 py-1 hover:bg-white/5 transition-colors text-left ${
                isHighlighted ? "bg-white/10" : ""
              } ${drv.no_timing ? "opacity-40" : ""}`}
            >
              {/* Position - 24px */}
              {isLeader ? (
                <span className="w-6 h-6 flex items-center justify-center rounded bg-f1-red text-white text-sm font-extrabold flex-shrink-0">
                  {drv.position}
                </span>
              ) : (
                <span className="w-6 text-sm font-extrabold text-white text-right flex-shrink-0">
                  {drv.position ?? "-"}
                </span>
              )}

              {/* Team color bar - 4px + 4px margin */}
              <span
                className="w-1 h-6 rounded-sm flex-shrink-0 mx-1"
                style={{ backgroundColor: drv.color }}
              />

              {/* Team abbreviation - 28px */}
              {settings.showTeamAbbr && (
                <span className="w-7 text-[10px] font-bold text-f1-muted flex-shrink-0">
                  {TEAM_ABBR[drv.team] || drv.team?.slice(0, 3).toUpperCase()}
                </span>
              )}

              {/* Driver abbreviation - 30px */}
              <span className="w-[30px] text-sm font-extrabold text-white flex-shrink-0">
                {drv.abbr}
              </span>

              {/* Pit indicator (non-race only) */}
              {!isRace && (
                <span className="w-[13px] ml-2 -mr-1 flex-shrink-0 flex items-center justify-center">
                  {drv.in_pit && (
                    <span className="w-[13px] h-[13px] bg-white rounded-[2px] flex items-center justify-center">
                      <span className="text-[8px] font-extrabold text-black leading-none">P</span>
                    </span>
                  )}
                </span>
              )}

              {/* Grid delta - 24px (race only) */}
              {isRace && settings.showGridChange && (
              <span className="w-6 flex-shrink-0 text-center">
                {!drv.retired && currentTime >= 10 && (
                  drv.pit_start ? (
                    <span className="text-[10px] font-bold text-white">Pit</span>
                  ) : drv.grid_position != null && drv.position != null && (() => {
                    const delta = drv.grid_position - drv.position;
                    if (delta > 0) return (
                      <span className="text-[10px] font-bold text-green-400">▲{delta}</span>
                    );
                    if (delta < 0) return (
                      <span className="text-[10px] font-bold text-red-400">▼{Math.abs(delta)}</span>
                    );
                    return null;
                  })()
                )}
              </span>
              )}

              {/* Flags - 16px */}
              <span className="w-4 flex-shrink-0 flex items-center justify-center">
                {drv.has_fastest_lap && (
                  <svg className="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M12 6v7l4.5 2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {drv.flag === "investigation" && (
                  <svg className="w-3.5 h-3.5 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 22h20L12 2zm0 6v7m0 2v2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {drv.flag === "penalty" && (
                  <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M12 7v6m0 3v1" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
              </span>

              {/* Gap / best time - 56px */}
              {settings.showGapToLeader && (
                <span className={`w-14 flex-shrink-0 text-xs font-bold text-right ${drv.in_pit && isRace ? "text-yellow-400" : isRace ? "text-f1-muted" : drv.position === 1 ? "text-purple-400" : "text-f1-muted"}`}>
                  {displayGap}
                </span>
              )}

              {/* Pit stops - 20px (race only) */}
              {isRace && settings.showPitStops && (
                <span className="w-5 flex-shrink-0 flex items-center justify-center ml-1">
                  {drv.pit_stops > 0 && (
                    <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white">
                      {drv.pit_stops}
                    </span>
                  )}
                </span>
              )}

              {/* Pit prediction - 36px (race only) */}
              {isRace && settings.showPitPrediction && (
                <span className="w-9 flex-shrink-0 flex items-center justify-end gap-0.5 ml-1">
                  {drv.pit_prediction != null && (
                    <>
                      <img src="/pit-return.png" alt="" className="w-3 h-3 opacity-50 invert" />
                      <span className="text-[10px] font-bold text-f1-muted">
                        P{drv.pit_prediction}
                      </span>
                    </>
                  )}
                </span>
              )}

              {/* Tyre history - 36px (race only) */}
              {isRace && settings.showTyreHistory && (
                <span className="w-9 flex-shrink-0 flex items-center justify-end gap-0.5">
                  {(drv.tyre_history || []).slice(-2).map((comp, i) => {
                    const hColor = TYRE_COLORS[comp] || "#888";
                    const hLabel = TYRE_SHORT[comp] || "?";
                    return (
                      <span
                        key={i}
                        className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-extrabold leading-none border opacity-50"
                        style={{
                          borderColor: hColor,
                          color: hColor,
                          backgroundColor: "transparent",
                        }}
                      >
                        {hLabel}
                      </span>
                    );
                  })}
                </span>
              )}

              {/* Current tyre compound - 20px */}
              {settings.showTyreType && (
                <span className="w-5 flex-shrink-0 flex items-center justify-center ml-1">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold leading-none border-2"
                    style={{
                      borderColor: tyreColor || "#555",
                      color: tyreColor || "#555",
                      backgroundColor: "transparent",
                    }}
                  >
                    {tyreLabel || ""}
                  </span>
                </span>
              )}

              {/* Tyre age - 20px */}
              {settings.showTyreAge && (
                <span className="w-5 flex-shrink-0 text-xs font-extrabold text-white text-right">
                  {drv.tyre_life ?? ""}
                </span>
              )}

            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
