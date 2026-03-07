"use client";

import { ReplayDriver } from "@/hooks/useReplaySocket";
import { ReplaySettings } from "@/hooks/useSettings";
import { TYRE_COLORS, TYRE_SHORT } from "@/lib/constants";

interface Props {
  drivers: ReplayDriver[];
  highlightedDrivers: string[];
  onDriverClick: (abbr: string) => void;
  settings: ReplaySettings;
  currentTime: number;
}

function formatGap(gap: string | null): string {
  if (!gap) return "";
  // "1L" or "1 L" -> "+1 Lap", "2L" or "2 L" -> "+2 Laps"
  const match = gap.match(/^(\d+)\s*L$/);
  if (match) {
    const n = parseInt(match[1]);
    return `+${n} Lap${n > 1 ? "s" : ""}`;
  }
  return gap;
}

export default function Leaderboard({ drivers, highlightedDrivers, onDriverClick, settings, currentTime }: Props) {
  const sorted = [...drivers].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );

  return (
    <div className="bg-f1-card border-l border-f1-border h-full overflow-y-auto">
      <div className="divide-y divide-f1-border/50">
        {sorted.map((drv) => {
          const isHighlighted = highlightedDrivers.includes(drv.abbr);
          const isLeader = drv.position === 1;
          const compound = drv.compound;
          const tyreColor = compound ? (TYRE_COLORS[compound] || "#888") : undefined;
          const tyreLabel = compound ? (TYRE_SHORT[compound] || "?") : null;

          return (
            <button
              key={drv.abbr}
              onClick={() => onDriverClick(drv.abbr)}
              className={`w-full flex items-center gap-2 px-2 py-1 hover:bg-white/5 transition-colors text-left ${
                isHighlighted ? "bg-white/10" : ""
              } ${drv.no_timing ? "opacity-40" : ""}`}
            >
              {/* Position */}
              {isLeader ? (
                <span className="w-6 h-6 flex items-center justify-center rounded bg-f1-red text-white text-sm font-extrabold flex-shrink-0">
                  {drv.position}
                </span>
              ) : (
                <span className="w-6 text-sm font-extrabold text-white text-right flex-shrink-0">
                  {drv.position ?? "-"}
                </span>
              )}

              {/* Team color bar */}
              <span
                className="w-1 h-6 rounded-sm flex-shrink-0"
                style={{ backgroundColor: drv.color }}
              />

              {/* Driver abbreviation + grid delta */}
              <span className="text-sm font-extrabold text-white flex-shrink-0">
                {drv.abbr}
              </span>
              {settings.showGridChange && !drv.retired && currentTime >= 10 && (
                drv.pit_start ? (
                  <span className="text-[10px] font-bold text-white flex-shrink-0">
                    Pit
                  </span>
                ) : drv.grid_position != null && drv.position != null && (() => {
                  const delta = drv.grid_position - drv.position;
                  if (delta > 0) return (
                    <span className="text-[10px] font-bold text-green-400 flex-shrink-0">
                      ▲{delta}
                    </span>
                  );
                  if (delta < 0) return (
                    <span className="text-[10px] font-bold text-red-400 flex-shrink-0">
                      ▼{Math.abs(delta)}
                    </span>
                  );
                  return null;
                })()
              )}

              {/* Flags: fastest lap + investigation/penalty */}
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

              {/* Gap to leader */}
              <span className="text-sm font-bold text-right flex-1 text-f1-muted">
                {drv.retired
                  ? "Out"
                  : settings.showGapToLeader
                  ? drv.position === 1
                    ? "Leader"
                    : formatGap(drv.gap)
                  : ""}
              </span>

              {/* Pit stops - "boxed" */}
              {settings.showPitStops && (
                <span className="w-5 flex-shrink-0 flex items-center justify-center">
                  {drv.pit_stops > 0 && (
                    <span className="w-5 h-5 border border-f1-muted rounded-sm flex items-center justify-center text-[10px] font-extrabold text-white">
                      {drv.pit_stops}
                    </span>
                  )}
                </span>
              )}

              {/* Tyre compound donut + age */}
              {(settings.showTyreType || settings.showTyreAge) && (
                <span className="flex items-center gap-1 flex-shrink-0 justify-end">
                  {settings.showTyreType && (
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
                  )}
                  {settings.showTyreAge && (
                    <span className="text-sm font-extrabold text-white w-5 text-center">
                      {drv.tyre_life ?? ""}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
