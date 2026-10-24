"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceArea,
} from "recharts";
import { ReplayDriver } from "@/hooks/useReplaySocket";
import { LapEntry } from "@/components/Leaderboard";
import { TYRE_COLORS, TYRE_SHORT } from "@/lib/constants";
import DriverDropdown from "@/components/DriverDropdown";

interface Props {
  laps: LapEntry[];
  drivers: ReplayDriver[];
  currentLap: number;
  onClose?: () => void;
}

function parseLapTime(timeStr: string): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  const val = parseFloat(parts[0]);
  return isNaN(val) ? null : val;
}

function formatSeconds(secs: number): string {
  const mins = Math.floor(secs / 60);
  const remainder = secs - mins * 60;
  return `${mins}:${remainder.toFixed(3).padStart(6, "0")}`;
}

const LAP_RANGES = [
  { label: "All", value: 0 },
  { label: "Last 5", value: 5 },
  { label: "Last 10", value: 10 },
  { label: "Last 20", value: 20 },
] as const;

export default function LapAnalysisPanel({ laps, drivers, currentLap, onClose }: Props) {
  const [selectedDrivers, setSelectedDrivers] = useState<[string | null, string | null]>([null, null]);
  const [lapRange, setLapRange] = useState<number>(0); // 0 = all
  const [lapOrder, setLapOrder] = useState<"asc" | "desc">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("f1replay_lap_order") as "asc" | "desc") || "asc";
    }
    return "asc";
  });

  const sortedDrivers = useMemo(
    () => [...drivers].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [drivers],
  );

  // Build per-driver lap arrays
  const driverLaps = useMemo(() => {
    const map = new Map<string, LapEntry[]>();
    for (const lap of laps) {
      let arr = map.get(lap.driver);
      if (!arr) {
        arr = [];
        map.set(lap.driver, arr);
      }
      arr.push(lap);
    }
    // Sort each by lap number
    for (const arr of map.values()) {
      arr.sort((a, b) => a.lap_number - b.lap_number);
    }
    return map;
  }, [laps]);

  // Chart data: merged by lap number for up to 2 drivers
  const { chartData, slowBands, pitBands, yDomain } = useMemo(() => {
    const active = selectedDrivers.filter((d): d is string => d !== null);
    if (active.length === 0) return { chartData: [], slowBands: [], pitBands: [], yDomain: [0, 0] as [number, number] };

    const maxLap = Math.max(...active.map((d) => {
      const dl = driverLaps.get(d);
      if (!dl) return 0;
      const filtered = dl.filter((l) => l.lap_number <= currentLap);
      return filtered.length > 0 ? filtered[filtered.length - 1].lap_number : 0;
    }));

    // Collect pit laps across all active drivers
    const pitLapSet = new Set<number>();
    for (const d of active) {
      const dl = driverLaps.get(d) || [];
      for (const l of dl) {
        if (l.pit_in || l.pit_out) pitLapSet.add(l.lap_number);
      }
    }

    // First pass: collect all clean lap times to compute median (skip lap 1 and pit laps)
    const allCleanTimes: number[] = [];
    for (let lap = 2; lap <= maxLap; lap++) {
      if (pitLapSet.has(lap)) continue;
      for (const d of active) {
        const dl = driverLaps.get(d);
        const entry = dl?.find((l) => l.lap_number === lap);
        if (entry?.lap_time && lap <= currentLap) {
          const secs = parseLapTime(entry.lap_time);
          if (secs !== null) allCleanTimes.push(secs);
        }
      }
    }
    allCleanTimes.sort((a, b) => a - b);
    const median = allCleanTimes.length > 0 ? allCleanTimes[Math.floor(allCleanTimes.length / 2)] : 0;
    const slowThreshold = median * 1.07; // 7% slower than median = likely SC/VSC/slow lap

    // Second pass: build chart data, detect slow laps
    const slowLapSet = new Set<number>();
    let minTime = Infinity;
    let maxTime = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any>[] = [];
    for (let lap = 1; lap <= maxLap; lap++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const point: Record<string, any> = { lap };
      const isPit = pitLapSet.has(lap);
      const isFirstLap = lap === 1;

      // Check if this lap is slow for any driver (also flag lap 1)
      let isSlow = false;
      if (!isPit && !isFirstLap) {
        for (const d of active) {
          const dl = driverLaps.get(d);
          const entry = dl?.find((l) => l.lap_number === lap);
          if (entry?.lap_time && lap <= currentLap) {
            const secs = parseLapTime(entry.lap_time);
            if (secs !== null && secs > slowThreshold) { isSlow = true; break; }
          }
        }
      }
      if (isSlow) slowLapSet.add(lap);

      // Store band type for tooltip
      point._bandType = isPit ? "pit" : isSlow ? "slow" : isFirstLap ? "lap1" : null;
      // Invisible hover target — must be within Y domain so it doesn't distort the axis
      point._hover = null;

      // Exclude pit laps, slow laps, and lap 1 from the line + Y-axis scaling
      const excludeFromLine = isPit || isSlow || isFirstLap;

      for (const d of active) {
        const dl = driverLaps.get(d);
        const entry = dl?.find((l) => l.lap_number === lap);
        // Always store the actual time for tooltip display
        if (entry?.lap_time && lap <= currentLap) {
          const secs = parseLapTime(entry.lap_time);
          if (secs !== null) {
            point[`_time_${d}`] = secs;
          }
        }
        if (entry?.lap_time && !excludeFromLine && lap <= currentLap) {
          const secs = parseLapTime(entry.lap_time);
          if (secs !== null) {
            point[d] = secs;
            if (secs < minTime) minTime = secs;
            if (secs > maxTime) maxTime = secs;
          } else {
            point[d] = null;
          }
        } else {
          point[d] = null;
        }
      }
      data.push(point);
    }

    // Build contiguous bands for slow laps and pit laps
    function buildBands(lapSet: Set<number>): { x1: number; x2: number }[] {
      const sorted = Array.from(lapSet).sort((a, b) => a - b);
      const bands: { x1: number; x2: number }[] = [];
      let i = 0;
      while (i < sorted.length) {
        const start = sorted[i];
        let end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
          i++;
          end = sorted[i];
        }
        bands.push({ x1: start - 0.5, x2: end + 0.5 });
        i++;
      }
      return bands;
    }

    // Set _hover to midpoint of Y range so tooltip triggers on every lap without distorting Y axis
    const mid = minTime < Infinity ? (minTime + maxTime) / 2 : 0;
    for (const point of data) {
      point._hover = mid;
    }

    const padding = (maxTime - minTime) * 0.1 || 2;
    return {
      chartData: data,
      slowBands: buildBands(slowLapSet),
      pitBands: buildBands(pitLapSet),
      yDomain: [Math.max(0, minTime - padding), maxTime + padding] as [number, number],
    };
  }, [selectedDrivers, driverLaps, currentLap]);

  const activeDrivers = selectedDrivers.filter((d): d is string => d !== null);

  // Filter chart data by lap range
  const { visibleChartData, visibleYDomain, visibleSlowBands, visiblePitBands } = useMemo(() => {
    if (lapRange === 0 || chartData.length === 0) {
      return { visibleChartData: chartData, visibleYDomain: yDomain, visibleSlowBands: slowBands, visiblePitBands: pitBands };
    }
    const minLap = Math.max(1, currentLap - lapRange);
    const filtered = chartData.filter((d) => (d.lap as number) >= minLap && (d.lap as number) <= currentLap);

    // Recompute Y domain for visible range
    let min = Infinity;
    let max = 0;
    for (const point of filtered) {
      for (const d of activeDrivers) {
        const v = point[d];
        if (v !== null && typeof v === "number") {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    const padding = (max - min) * 0.1 || 2;
    const vYDomain: [number, number] = min < Infinity ? [Math.max(0, min - padding), max + padding] : yDomain;

    // Filter bands to visible range
    const filterBands = (bands: { x1: number; x2: number }[]) =>
      bands.filter((b) => b.x2 >= minLap && b.x1 <= currentLap)
        .map((b) => ({ x1: Math.max(b.x1, minLap), x2: Math.min(b.x2, currentLap) }));

    return {
      visibleChartData: filtered,
      visibleYDomain: vYDomain,
      visibleSlowBands: filterBands(slowBands),
      visiblePitBands: filterBands(pitBands),
    };
  }, [chartData, yDomain, slowBands, pitBands, lapRange, currentLap, activeDrivers]);

  const SECOND_DRIVER_COLOR = "#06B6D4"; // cyan to contrast any team colour

  function getDriverColor(abbr: string): string {
    const teamColor = drivers.find((d) => d.abbr === abbr)?.color || "#888";
    // If two drivers selected and they share a team colour, use a distinct colour for the second
    if (activeDrivers.length === 2 && abbr === activeDrivers[1]) {
      const firstColor = drivers.find((d) => d.abbr === activeDrivers[0])?.color || "#888";
      if (firstColor.toLowerCase() === teamColor.toLowerCase()) {
        return SECOND_DRIVER_COLOR;
      }
    }
    return teamColor;
  }

  return (
    <div className="h-full flex flex-col bg-f1-card overflow-hidden">
      {/* Header - only shown on desktop (mobile has its own collapsible header) */}
      {onClose && (
        <div className="px-3 py-2 border-b border-f1-border flex-shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider">Lap Analysis</span>
          <button onClick={onClose} className="px-2 py-0.5 bg-f1-card/90 border border-f1-border rounded text-[9px] font-bold text-f1-muted hover:text-white transition-colors">
            Hide
          </button>
        </div>
      )}

      {/* Driver selectors */}
      <div className="px-3 py-2 space-y-1.5 flex-shrink-0 border-b border-f1-border">
        <DriverDropdown
          value={selectedDrivers[0]}
          onChange={(abbr) => setSelectedDrivers((prev) => [abbr, prev[1]])}
          drivers={sortedDrivers}
          placeholder="Select driver..."
          getColor={getDriverColor}
        />
        <DriverDropdown
          value={selectedDrivers[1]}
          onChange={(abbr) => setSelectedDrivers((prev) => [prev[0], abbr])}
          drivers={sortedDrivers}
          placeholder="Compare with..."
          getColor={getDriverColor}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeDrivers.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-f1-muted">
            Select a driver to view lap times
          </div>
        ) : (
          <>
            {/* Lap range toggle + Chart */}
            {chartData.length > 0 && (
              <div className="px-2 pt-2 pb-1 flex-shrink-0">
                <div className="flex items-center gap-1 mb-2">
                  {LAP_RANGES.map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setLapRange(value)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                        lapRange === value
                          ? "bg-f1-red text-white"
                          : "bg-f1-dark border border-f1-border text-f1-muted hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={visibleChartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <XAxis
                      dataKey="lap"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tick={{ fill: "#6B7280", fontSize: 7 }}
                      tickLine={false}
                      axisLine={{ stroke: "#374151" }}
                      allowDecimals={false}
                      ticks={visibleChartData.map((d) => d.lap as number)}
                    />
                    <YAxis
                      domain={visibleYDomain}
                      allowDataOverflow={true}
                      tick={{ fill: "#6B7280", fontSize: 9 }}
                      tickLine={false}
                      axisLine={{ stroke: "#374151" }}
                      tickFormatter={(v: number) => formatSeconds(v)}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const point = payload[0]?.payload as Record<string, any> | undefined;
                        if (!point) return null;
                        const bandType = point._bandType as string | null;
                        const bandLabel = bandType === "pit" ? "Pit Stop" : bandType === "slow" ? "Yellow Flag / Slow Lap" : bandType === "lap1" ? "Formation / Lap 1" : null;
                        return (
                          <div className="bg-[#1A1A26] border border-f1-border rounded-md px-2.5 py-1.5 text-[11px] shadow-xl">
                            <div className="font-bold text-white mb-0.5">Lap {label}</div>
                            {bandLabel && (
                              <div className={`font-bold mb-0.5 ${bandType === "slow" ? "text-yellow-400" : "text-f1-muted"}`}>
                                {bandLabel}
                              </div>
                            )}
                            {activeDrivers.map((abbr) => {
                              const time = point[`_time_${abbr}`];
                              const lineVal = point[abbr];
                              return (
                                <div key={abbr} className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDriverColor(abbr) }} />
                                  <span className="text-f1-muted">{abbr}:</span>
                                  <span className={lineVal != null ? "text-white" : "text-f1-muted"}>
                                    {time != null ? formatSeconds(time) : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {/* Slow lap bands (safety car / yellow flag) */}
                    {visibleSlowBands.map((band, i) => (
                      <ReferenceArea
                        key={`slow-${i}`}
                        x1={band.x1}
                        x2={band.x2}
                        y1={visibleYDomain[0]}
                        y2={visibleYDomain[1]}
                        fill="#EAB308"
                        fillOpacity={0.15}
                        stroke="#EAB308"
                        strokeOpacity={0.3}
                        strokeDasharray="3 3"
                        ifOverflow="extendDomain"
                      />
                    ))}
                    {/* Pit lap bands */}
                    {visiblePitBands.map((band, i) => (
                      <ReferenceArea
                        key={`pit-${i}`}
                        x1={band.x1}
                        x2={band.x2}
                        y1={visibleYDomain[0]}
                        y2={visibleYDomain[1]}
                        fill="#FFFFFF"
                        fillOpacity={0.06}
                        stroke="#6B7280"
                        strokeOpacity={0.3}
                        strokeDasharray="3 3"
                        ifOverflow="extendDomain"
                      />
                    ))}
                    {/* Invisible line to enable tooltip on every lap including banded laps */}
                    <Line
                      type="monotone"
                      dataKey="_hover"
                      stroke="transparent"
                      strokeWidth={0}
                      dot={false}
                      activeDot={false}
                      name="_hover"
                      legendType="none"
                    />
                    {activeDrivers.map((abbr) => (
                      <Line
                        key={abbr}
                        type="monotone"
                        dataKey={abbr}
                        stroke={getDriverColor(abbr)}
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls={false}
                        name={abbr}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Lap list */}
            <div className="px-3 pb-2">
              {/* Header row */}
              <div className="flex items-center gap-1 py-1 border-b border-f1-border">
                <button
                  onClick={() => {
                    const next = lapOrder === "asc" ? "desc" : "asc";
                    setLapOrder(next);
                    try { localStorage.setItem("f1replay_lap_order", next); } catch {}
                  }}
                  className="w-8 text-[9px] font-bold text-f1-muted hover:text-white transition-colors flex items-center gap-0.5"
                  title={lapOrder === "asc" ? "Show latest first" : "Show earliest first"}
                >
                  LAP
                  <svg className={`w-2.5 h-2.5 transition-transform ${lapOrder === "desc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {activeDrivers.map((abbr) => (
                  <div key={abbr} className="flex-1 flex items-center gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getDriverColor(abbr) }}
                    />
                    <span className="text-[9px] font-bold text-f1-muted">{abbr}</span>
                  </div>
                ))}
                {activeDrivers.length === 2 && (
                  <span className="w-14 text-[9px] font-bold text-f1-muted text-right flex-shrink-0">DELTA</span>
                )}
              </div>

              {/* Lap rows */}
              {(() => {
                const maxLap = Math.max(
                  ...activeDrivers.map((d) => {
                    const dl = driverLaps.get(d) || [];
                    const filtered = dl.filter((l) => l.lap_number <= currentLap);
                    return filtered.length > 0 ? filtered[filtered.length - 1].lap_number : 0;
                  }),
                );
                const rows = [];
                const startLap = lapOrder === "desc" ? maxLap : 1;
                const endLap = lapOrder === "desc" ? 1 : maxLap;
                const step = lapOrder === "desc" ? -1 : 1;
                for (let lap = startLap; lapOrder === "desc" ? lap >= endLap : lap <= endLap; lap += step) {
                  rows.push(
                    <div
                      key={lap}
                      className={`flex items-center gap-1 py-0.5 ${lap === currentLap ? "bg-white/5" : ""}`}
                    >
                      <span className="w-8 text-[10px] font-bold text-f1-muted tabular-nums">{lap}</span>
                      {activeDrivers.map((abbr) => {
                        const dl = driverLaps.get(abbr) || [];
                        const entry = dl.find((l) => l.lap_number === lap);
                        const isPit = entry?.pit_in || entry?.pit_out;
                        const compound = entry?.compound;
                        const tyreColor = compound ? TYRE_COLORS[compound] || "#888" : undefined;
                        const tyreLabel = compound ? TYRE_SHORT[compound] || "?" : null;

                        return (
                          <div key={abbr} className="flex-1 flex items-center gap-1">
                            <span
                              className={`text-[10px] tabular-nums ${
                                isPit ? "text-yellow-400" : "text-white"
                              }`}
                            >
                              {entry?.lap_time || "—"}
                            </span>
                            {isPit && (
                              <span className="text-[8px] font-bold text-yellow-400">PIT</span>
                            )}
                            {tyreLabel && (
                              <span
                                className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-extrabold leading-none border flex-shrink-0"
                                style={{ borderColor: tyreColor, color: tyreColor }}
                              >
                                {tyreLabel}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {activeDrivers.length === 2 && (() => {
                        const dl0 = driverLaps.get(activeDrivers[0]) || [];
                        const dl1 = driverLaps.get(activeDrivers[1]) || [];
                        const e0 = dl0.find((l) => l.lap_number === lap);
                        const e1 = dl1.find((l) => l.lap_number === lap);
                        const t0 = e0?.lap_time ? parseLapTime(e0.lap_time) : null;
                        const t1 = e1?.lap_time ? parseLapTime(e1.lap_time) : null;
                        if (t0 === null || t1 === null) return <span className="w-14 flex-shrink-0" />;
                        // Delta from driver 1's perspective: positive = driver 1 slower, negative = driver 1 faster
                        const delta = t0 - t1;
                        const absDelta = Math.abs(delta);
                        const sign = delta > 0.001 ? "+" : delta < -0.001 ? "-" : "";
                        const color = delta < -0.001 ? "text-green-400" : delta > 0.001 ? "text-red-400" : "text-f1-muted";
                        return (
                          <span className={`w-14 flex-shrink-0 text-[10px] font-bold tabular-nums text-right ${color}`}>
                            {sign}{absDelta.toFixed(3)}
                          </span>
                        );
                      })()}
                    </div>,
                  );
                }
                return rows;
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
