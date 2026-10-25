"use client";

import { useState, useRef, useEffect } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";
import { ReplaySettings } from "@/hooks/useSettings";
import { TYRE_COLORS, TYRE_SHORT, TEAM_ABBR } from "@/lib/constants";
import { lapColorClass, SectorMarkers } from "@/lib/lapTiming";
import { MiniSectorMarkers, miniMarkersWidth } from "@/lib/miniSectors";

export interface LapEntry {
  driver: string;
  lap_number: number;
  lap_time: string | null;
  time: number | null; // session-elapsed seconds when lap was completed
  compound: string | null;
  tyre_life?: number | null;
  sector1?: string | null;
  sector2?: string | null;
  sector3?: string | null;
  /** Lap time deleted by the stewards (sessions processed after Phase 6) */
  deleted?: boolean;
  deleted_reason?: string;
  /** When S1 and S2 ended, in replay seconds */
  s1_end?: number | null;
  s2_end?: number | null;
  pit_in: boolean;
  pit_out: boolean;
}

interface Props {
  drivers: ReplayDriver[];
  highlightedDrivers: string[];
  onDriverClick: (abbr: string) => void;
  settings: ReplaySettings;
  currentTime: number;
  isRace: boolean;
  isQualifying?: boolean;
  compact?: boolean;
  onScaleChange?: (scale: number) => void;
  lapData?: Map<string, Map<number, { time: string; completedAt: number | null }>>;
  currentLap?: number;
  mobileTeamAbbrHidden?: boolean;
  /** Mini-sector statuses per driver; replaces the three sector squares */
  miniSectors?: { counts: number[]; states: Map<string, number[] | null> } | null;
}

function formatGap(gap: string | null): string {
  if (!gap) return "";
  // Handle "1L", "2L" format (gap to leader)
  const lapped = gap.match(/^(\d+)\s*L$/);
  if (lapped) {
    const n = parseInt(lapped[1]);
    return `+${n} Lap${n > 1 ? "s" : ""}`;
  }
  // Handle "LAP 1", "LAP 0" format (interval data)
  const lapFormat = gap.match(/^LAP\s+(\d+)$/i);
  if (lapFormat) {
    const n = parseInt(lapFormat[1]);
    if (n === 0) return "Interval";
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
    // Use real interval data from F1 timing feed if available
    if (drv.interval) {
      intervals.set(drv.abbr, formatGap(drv.interval));
      continue;
    }
    // Fallback: compute from gap-to-leader differences
    const currGap = parseGapSeconds(drv.gap);
    const prevGap = parseGapSeconds(sorted[i - 1].gap);
    if (currGap !== null && prevGap !== null) {
      const diff = currGap - prevGap;
      intervals.set(drv.abbr, `+${diff.toFixed(3)}`);
    } else {
      intervals.set(drv.abbr, formatGap(drv.gap));
    }
  }
  return intervals;
}

export default function Leaderboard({ drivers, highlightedDrivers, onDriverClick, settings, currentTime, isRace, isQualifying, compact, onScaleChange, lapData, currentLap, mobileTeamAbbrHidden, miniSectors }: Props) {
  const [showInterval, setShowInterval] = useState(true);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updateScale() {
      if (compact) {
        setScale(1);
        onScaleChange?.(1);
        return;
      }
      if (!containerRef.current || !contentRef.current) return;
      // On mobile (< 640px), don't scale - let it scroll instead
      if (window.innerWidth < 640) {
        setScale(1);
        onScaleChange?.(1);
        return;
      }
      const containerH = containerRef.current.clientHeight;
      const contentH = contentRef.current.scrollHeight;
      let newScale = 1;
      if (contentH > containerH && contentH > 0) {
        newScale = Math.max(0.55, containerH / contentH);
      }
      setScale(newScale);
      onScaleChange?.(newScale);
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [drivers.length, settings.showGapToLeader, settings.showBestLapTime, settings.showLastLapTime, isRace, compact, onScaleChange]);

  const sorted = [...drivers].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );

  const intervals = isRace && showInterval ? computeIntervals(sorted) : null;

  return (
    <div ref={containerRef} className={`bg-f1-card border-f1-border h-full ${compact ? "overflow-y-auto" : "overflow-y-auto sm:overflow-hidden"}`}>
      <div ref={contentRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${100 / scale}%` }}>

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
            if (!isRace) {
              // For practice/qualifying: gap column shows gap to leader
              if (drv.position === 1) return "";
              return formatGap(drv.gap);
            }
            return formatGap(drv.gap);
          })();

          return (
            <button
              key={drv.abbr}
              onClick={() => onDriverClick(drv.abbr)}
              className={`w-full flex items-center px-1 sm:px-2 py-1 hover:bg-white/5 transition-colors text-left ${
                isHighlighted ? "bg-white/10" : ""
              } ${drv.no_timing ? "opacity-40" : drv.knocked_out ? "opacity-50" : ""}`}
            >
              {/* Position - 20px mobile, 24px desktop */}
              {isLeader ? (
                <span className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded bg-f1-red text-white text-[14px] sm:text-sm font-extrabold flex-shrink-0">
                  {drv.position}
                </span>
              ) : (
                <span className="w-5 sm:w-6 text-[14px] sm:text-sm font-extrabold text-white text-right flex-shrink-0">
                  {drv.position ?? "-"}
                </span>
              )}

              {/* Team color bar - 4px + 4px margin */}
              <span
                className="w-1 h-6 rounded-sm flex-shrink-0 mx-1"
                style={{ backgroundColor: drv.color }}
              />

              {/* Team abbreviation - 28px */}
              {settings.showTeamAbbr && !mobileTeamAbbrHidden && (
                <span className="w-7 text-[10px] font-bold text-f1-muted flex-shrink-0" title="Team">
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
              <span className="w-6 flex-shrink-0 text-center" title="Grid position change">
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
              <span className={`w-4 flex-shrink-0 flex items-center justify-center ${!isRace ? "ml-1.5" : ""}`}>
                {isRace && drv.has_fastest_lap && (
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

              {/* Best lap time (practice/qualifying only) */}
              {!isRace && settings.showBestLapTime && (
                <span className={`w-[60px] flex-shrink-0 text-xs font-bold text-right ${drv.position === 1 ? "text-purple-400" : "text-white"}`} title="Best lap time">
                  {drv.retired ? "Out" : (drv.best_lap_time || (drv.position === 1 ? formatGap(drv.gap) : null) || "")}
                </span>
              )}

              {/* Gap to leader */}
              {settings.showGapToLeader && (
                isRace && isLeader && !drv.retired ? (
                  <span
                    className="w-14 flex-shrink-0 flex justify-start"
                    onClick={(e) => { e.stopPropagation(); setShowInterval(!showInterval); }}
                  >
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-white/10 text-white cursor-pointer hover:bg-white/20 transition-colors">
                      {showInterval ? "Interval" : "Leader"}
                    </span>
                  </span>
                ) : isRace ? (
                  drv.in_pit && !drv.retired ? (
                    <span className="w-14 flex-shrink-0 text-left text-yellow-400" title="In pit lane">
                      <span className="text-xs font-bold">PIT</span>
                      {drv.pit_time != null && (
                        <span className="text-[9px] font-bold ml-0.5 tabular-nums">{drv.pit_time.toFixed(1)}s</span>
                      )}
                    </span>
                  ) : (
                    <span title={showInterval ? "Interval to car ahead" : "Gap to leader"} className={`w-14 flex-shrink-0 text-xs font-bold text-left tabular-nums ${
                      showInterval && settings.highlightClose && displayGap && (() => {
                          const val = parseFloat(displayGap.replace("+", ""));
                          return !isNaN(val) && val > 0 && val < 1;
                        })()
                        ? "text-green-400"
                        : "text-f1-muted"
                    }`}>
                      {displayGap}
                    </span>
                  )
                ) : (
                  <span className={`w-14 flex-shrink-0 text-xs font-bold text-left tabular-nums text-f1-muted ml-3 sm:ml-2`} title="Gap to leader">
                    {displayGap}
                  </span>
                )
              )}

              {/* Last lap time */}
              {settings.showLastLapTime && (() => {
                // Live timing: F1's last lap time and colour flags
                if (!lapData && drv.last_lap !== undefined) {
                  const last = drv.retired ? null : drv.last_lap;
                  const color = last?.overall ? "text-purple-400" : last?.personal ? "text-green-400" : "text-f1-muted";
                  return (
                    <span className={`w-[50px] sm:w-[60px] flex-shrink-0 text-[11px] sm:text-xs text-right tabular-nums ${color}`} title="Last lap time">
                      {last?.time ?? ""}
                    </span>
                  );
                }

                const driverLaps = lapData?.get(drv.abbr);
                if (!driverLaps) return (
                  <span className="w-[50px] sm:w-[60px] flex-shrink-0" />
                );

                // Find the driver's most recent completed lap up to the current replay time
                let lastLapTime: string | null = null;
                let lastLapNum = 0;
                if (isRace) {
                  // Races: use global currentLap
                  for (let l = (currentLap || 0); l >= 1; l--) {
                    const entry = driverLaps.get(l);
                    if (entry) { lastLapTime = entry.time; lastLapNum = l; break; }
                  }
                } else {
                  // Practice/qualifying: use timestamp to find laps completed before current time
                  for (const [lapNum, entry] of driverLaps) {
                    if (entry.completedAt !== null && entry.completedAt <= currentTime && lapNum > lastLapNum) {
                      lastLapTime = entry.time;
                      lastLapNum = lapNum;
                    }
                  }
                }

                if (!lastLapTime || lastLapNum < 2 || drv.retired) return (
                  <span className="w-[50px] sm:w-[60px] flex-shrink-0 text-[11px] sm:text-xs text-right tabular-nums text-f1-muted" title="Last lap time">
                    {drv.retired ? "" : (lastLapTime || "")}
                  </span>
                );

                const color = lapColorClass(lastLapTime, drv.abbr, lapData, currentTime, currentLap || 0, isRace, drv.has_fastest_lap);

                return (
                  <span className={`w-[50px] sm:w-[60px] flex-shrink-0 text-[11px] sm:text-xs text-right tabular-nums ${color}`} title="Last lap time">
                    {lastLapTime}
                  </span>
                );
              })()}

              {/* Live sector indicators - fixed width (qualifying and practice); OUT on an out-lap */}
              {!isRace && settings.showSectors && (
                drv.out_lap && !drv.in_pit ? (
                  // Same width as the markers it replaces, so columns don't shift
                  <span
                    className={`${miniSectors ? "" : "w-7 "}flex-shrink-0 mx-1 text-center text-[9px] font-extrabold text-white/80`}
                    style={miniSectors ? { width: miniMarkersWidth(miniSectors.counts) } : undefined}
                    title="Out lap"
                  >
                    OUT
                  </span>
                ) : miniSectors ? (
                  <MiniSectorMarkers states={miniSectors.states.get(drv.abbr) ?? null} counts={miniSectors.counts} className="flex-shrink-0 mx-1" />
                ) : (
                  <SectorMarkers sectors={drv.sectors} className="w-7 flex-shrink-0 mx-1" />
                )
              )}

              {/* Pit stops / chequered flag - 20px (race only) */}
              {isRace && settings.showPitStops && (
                <span className="w-5 flex-shrink-0 flex items-center justify-center ml-1" title={drv.finished ? "Finished" : "Pit stops"}>
                  {drv.finished ? (
                    <img src="/chequered-flag.png" alt="Finished" className="w-5 h-5 object-contain" />
                  ) : drv.pit_stops > 0 ? (
                    <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white">
                      {drv.pit_stops}
                    </span>
                  ) : null}
                </span>
              )}

              {/* Pit prediction - 36px (race only) */}
              {isRace && settings.showPitPrediction && (
                <span className="w-9 flex-shrink-0 flex items-center justify-end gap-0.5 ml-1" title="Predicted position after pit stop">
                  {drv.pit_prediction != null && (
                    <>
                      <span className={`flex items-center gap-0.5 text-[10px] font-bold ${
                        settings.showPitConfidence && drv.pit_prediction_margin != null
                          ? drv.pit_prediction_margin < 1 ? "text-red-400"
                          : drv.pit_prediction_margin < 2.5 ? "text-yellow-400"
                          : "text-f1-muted"
                          : "text-f1-muted"
                      }`}>
                        <svg className="w-4 h-4 opacity-70 -scale-y-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 14l-4-4 4-4" />
                          <path d="M5 10h11a4 4 0 0 1 0 8h-1" />
                        </svg>
                        P{drv.pit_prediction}
                      </span>
                    </>
                  )}
                </span>
              )}

              {/* Pit gaps (ahead / behind) stacked - race only, shown with pit prediction */}
              {isRace && settings.showPitPrediction && settings.showPitFreeAir && (
                <span className="w-9 flex-shrink-0 flex flex-col items-end leading-tight" title="Pit gaps: ↑ gap ahead, ↓ gap behind">
                  {drv.pit_prediction != null && (
                    <>
                      <span className="text-[8px] font-bold text-f1-muted">
                        {drv.pit_prediction_free_air != null
                          ? `↑${drv.pit_prediction_free_air.toFixed(1)}s`
                          : "—"}
                      </span>
                      <span className={`text-[8px] font-bold ${
                        settings.showPitConfidence && drv.pit_prediction_margin != null
                          ? drv.pit_prediction_margin < 1 ? "text-red-400"
                          : drv.pit_prediction_margin < 2.5 ? "text-yellow-400"
                          : "text-f1-muted"
                          : "text-f1-muted"
                      }`}>
                        {drv.pit_prediction_margin != null
                          ? `↓${drv.pit_prediction_margin.toFixed(1)}s`
                          : "—"}
                      </span>
                    </>
                  )}
                </span>
              )}

              {/* Tyre history - 36px (race only) */}
              {isRace && settings.showTyreHistory && (
                <span className="w-9 flex-shrink-0 flex items-center justify-end gap-0.5" title="Tyre history">
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
                <span className="w-5 flex-shrink-0 flex items-center justify-center ml-1" title="Current tyre">
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
                <span className="w-5 flex-shrink-0 text-xs font-extrabold text-white text-right" title="Tyre age (laps)">
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
