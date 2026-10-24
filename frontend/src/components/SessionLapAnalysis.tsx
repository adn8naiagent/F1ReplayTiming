"use client";

import { useState, useMemo, useEffect } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ReplayDriver, QualiPhaseInfo } from "@/hooks/useReplaySocket";
import { LapEntry } from "@/components/Leaderboard";
import DriverDropdown from "@/components/DriverDropdown";
import LapTraceChart from "@/components/LapTraceChart";
import { fetchLapTelemetry, compareLaps, dominanceOverlay, LapComparison, DominanceOverlay } from "@/lib/lapCompare";
import { TYRE_COLORS, TYRE_SHORT } from "@/lib/constants";
import { lapColorClass, LapData } from "@/lib/lapTiming";
import {
  ParsedLap,
  SessionBests,
  parseLaps,
  isComplete,
  computeSessionBests,
  sectorColor,
  idealLap,
  theoreticalBest,
  formatLapSecs,
  formatDelta,
  SECTOR_COLOR_CLASS,
} from "@/lib/sectorTiming";

// Lap Analysis for qualifying, sprint qualifying and practice. Laps don't
// line up by lap number across drivers here, so the chart runs on session
// time and each driver gets their own lap list.

interface Props {
  laps: LapEntry[];
  drivers: ReplayDriver[];
  currentTime: number;
  currentLap: number;
  lapData: LapData | undefined;
  qualiPhases: QualiPhaseInfo[];
  isQualifying: boolean;
  year: number;
  round: number;
  sessionType: string;
  /** Shows track dominance on the main track map (desktop) */
  onDominanceChange?: (overlay: DominanceOverlay | null) => void;
  onClose?: () => void;
}

const SECOND_DRIVER_COLOR = "#06B6D4"; // cyan, when both drivers' team colours are too alike
const SECTORS = ["S1", "S2", "S3"] as const;

interface ChartPoint {
  x: number; // minutes into the session
  y: number;
  lap: ParsedLap;
}

/** Rough distance between two #RRGGBB colours (0–441). */
function colorDistance(a: string, b: string): number {
  const rgb = (h: string) => {
    const n = parseInt(h.replace("#", "").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function fmt(secs: number | null): string {
  return secs === null ? "—" : formatLapSecs(secs);
}

function deltaClass(delta: number): string {
  return delta < -0.0005 ? "text-green-400" : delta > 0.0005 ? "text-red-400" : "text-f1-muted";
}

type Tab = "sectors" | "compare";

export default function SessionLapAnalysis({
  laps, drivers, currentTime, currentLap, lapData, qualiPhases, isQualifying,
  year, round, sessionType, onDominanceChange, onClose,
}: Props) {
  // The desktop panel has a Hide button; the mobile section doesn't. Lap
  // traces and track dominance are desktop only.
  const desktop = !!onClose;
  const [tab, setTab] = useState<Tab>(() => {
    try { return localStorage.getItem("f1replay_lap_tab") === "compare" ? "compare" : "sectors"; } catch { return "sectors"; }
  });
  const [driver, setDriver] = useState<string | null>(null);
  const [compare, setCompare] = useState<[string | null, string | null]>([null, null]);
  const [range, setRange] = useState<string>("All");
  const [listDriver, setListDriver] = useState<string | null>(null);
  const [selectedLap, setSelectedLap] = useState<Record<string, number>>({});
  const [lapOrder, setLapOrder] = useState<"asc" | "desc">(() => {
    try { return (localStorage.getItem("f1replay_lap_order") as "asc" | "desc") || "asc"; } catch { return "asc"; }
  });

  const sortedDrivers = useMemo(
    () => [...drivers].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [drivers],
  );
  const driverLaps = useMemo(() => parseLaps(laps), [laps]);
  const bests = useMemo(() => computeSessionBests(driverLaps, currentTime), [driverLaps, currentTime]);
  const active = tab === "sectors"
    ? (driver ? [driver] : [])
    : compare.filter((d): d is string => d !== null);

  function getDriverColor(abbr: string): string {
    const color = drivers.find((d) => d.abbr === abbr)?.color || "#888";
    if (active.length === 2 && abbr === active[1]) {
      const first = drivers.find((d) => d.abbr === active[0])?.color || "#888";
      // Teammates, or colours too close to tell apart (e.g. red and orange)
      if (colorDistance(first, color) < 150) return SECOND_DRIVER_COLOR;
    }
    return color;
  }

  const switchTab = (next: Tab) => {
    setTab(next);
    try { localStorage.setItem("f1replay_lap_tab", next); } catch {}
  };

  // The lap list shows one driver at a time; follow the selection.
  const shownDriver = listDriver && active.includes(listDriver) ? listDriver : active[0] ?? null;

  // Forget selected laps that haven't happened yet (after seeking backwards).
  useEffect(() => {
    setSelectedLap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [abbr, lapNum] of Object.entries(prev)) {
        const lap = driverLaps.get(abbr)?.find((l) => l.lapNumber === lapNum);
        if (!lap || !isComplete(lap, currentTime)) {
          delete next[abbr];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentTime, driverLaps]);

  // Esc clears the lap selection.
  useEffect(() => {
    if (Object.keys(selectedLap).length === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedLap({}); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLap]);

  // Ranges: qualifying phases that have started, or practice's last 10 laps.
  const ranges = useMemo(() => {
    if (isQualifying) {
      const started = qualiPhases.filter((p) => p.timestamp <= currentTime);
      return ["All", ...(started.length > 1 ? started.map((p) => p.phase) : [])];
    }
    return ["All", "Last 10"];
  }, [isQualifying, qualiPhases, currentTime]);
  const activeRange = ranges.includes(range) ? range : "All";

  // Completed laps in the chosen range, per driver.
  const visibleLaps = useMemo(() => {
    const out = new Map<string, ParsedLap[]>();
    const phaseIdx = qualiPhases.findIndex((p) => p.phase === activeRange);
    const from = phaseIdx >= 0 ? qualiPhases[phaseIdx].timestamp : -Infinity;
    const to = phaseIdx >= 0 && phaseIdx + 1 < qualiPhases.length ? qualiPhases[phaseIdx + 1].timestamp : Infinity;
    for (const abbr of active) {
      let list = (driverLaps.get(abbr) || []).filter((l) => isComplete(l, currentTime));
      if (phaseIdx >= 0) list = list.filter((l) => l.completedAt! >= from && l.completedAt! < to);
      if (activeRange === "Last 10") list = list.slice(-10);
      out.set(abbr, list);
    }
    return out;
  }, [active.join(","), driverLaps, currentTime, activeRange, qualiPhases]); // eslint-disable-line react-hooks/exhaustive-deps

  // Practice chart: lap time through the session. Out and in laps, and slow
  // laps (cool-downs, traffic: over 107% of the session's best), are left out;
  // a gap in the running breaks the line.
  const chart = useMemo(() => {
    const runs: { abbr: string; points: ChartPoint[] }[] = [];
    const cutoff = bests.lap ? bests.lap.secs * 1.07 : Infinity;
    let min = Infinity;
    let max = -Infinity;
    for (const abbr of active) {
      let run: ChartPoint[] = [];
      for (const lap of visibleLaps.get(abbr) || []) {
        const flying = lap.kind === "push" && lap.lapSecs !== null && lap.lapSecs <= cutoff;
        if (!flying) {
          if (run.length) runs.push({ abbr, points: run });
          run = [];
          continue;
        }
        run.push({ x: lap.completedAt! / 60, y: lap.lapSecs!, lap });
        min = Math.min(min, lap.lapSecs!);
        max = Math.max(max, lap.lapSecs!);
      }
      if (run.length) runs.push({ abbr, points: run });
    }
    const pad = (max - min) * 0.1 || 0.5;
    const domain: [number, number] = min === Infinity ? [0, 1] : [Math.max(0, min - pad), max + pad];
    return { runs, domain };
  }, [visibleLaps, bests.lap, active.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const lapOf = (abbr: string, lapNumber: number | undefined) =>
    lapNumber === undefined ? undefined : driverLaps.get(abbr)?.find((l) => l.lapNumber === lapNumber);

  // The comparison always uses each driver's best lap so far.
  const bestLap = (abbr: string): ParsedLap | undefined => lapOf(abbr, bests.personalLap.get(abbr)?.lapNumber);

  // Lap traces for the two best laps (desktop, Compare tab).
  const comparing = desktop && tab === "compare" && active.length === 2;
  const bestA = comparing ? bests.personalLap.get(active[0]) : undefined;
  const bestB = comparing ? bests.personalLap.get(active[1]) : undefined;
  const traceKey = bestA && bestB ? `${active[0]}:${bestA.lapNumber}|${active[1]}:${bestB.lapNumber}` : null;
  const [traces, setTraces] = useState<{ key: string; comparison: LapComparison | null } | null>(null);
  const [dominanceOn, setDominanceOn] = useState(false);

  useEffect(() => {
    if (!traceKey || !bestA || !bestB) { setTraces(null); return; }
    let cancelled = false;
    setTraces((prev) => (prev?.key === traceKey ? prev : null));
    Promise.all([
      fetchLapTelemetry(year, round, sessionType, active[0], bestA.lapNumber),
      fetchLapTelemetry(year, round, sessionType, active[1], bestB.lapNumber),
    ])
      .then(([a, b]) => { if (!cancelled) setTraces({ key: traceKey, comparison: compareLaps(a, b, bestA.secs, bestB.secs) }); })
      .catch(() => { if (!cancelled) setTraces({ key: traceKey, comparison: null }); });
    return () => { cancelled = true; };
  }, [traceKey, year, round, sessionType]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparison = traces?.key === traceKey ? traces?.comparison ?? null : null;
  const colorA = active[0] ? getDriverColor(active[0]) : "";
  const colorB = active[1] ? getDriverColor(active[1]) : "";

  // Track dominance on the main map, while it's switched on here.
  useEffect(() => {
    if (!onDominanceChange) return;
    onDominanceChange(
      dominanceOn && comparing && comparison
        ? dominanceOverlay(comparison, active[0], active[1], colorA, colorB)
        : null,
    );
  }, [dominanceOn, comparing, comparison, colorA, colorB]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDominanceChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLap = (abbr: string, lapNumber: number) =>
    setSelectedLap((prev) => {
      const next = { ...prev };
      if (next[abbr] === lapNumber) delete next[abbr];
      else next[abbr] = lapNumber;
      return next;
    });

  const lapList = (
    <div className="px-3 pb-2">
      {active.length === 2 && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[9px] text-f1-muted mr-1">Laps:</span>
          {active.map((abbr) => (
            <button
              key={abbr}
              onClick={() => setListDriver(abbr)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                shownDriver === abbr ? "bg-white/10 text-white" : "text-f1-muted hover:text-white"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDriverColor(abbr) }} />
              {abbr}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 py-1 border-b border-f1-border text-[9px] font-bold text-f1-muted">
        <button
          onClick={() => {
            const next = lapOrder === "asc" ? "desc" : "asc";
            setLapOrder(next);
            try { localStorage.setItem("f1replay_lap_order", next); } catch {}
          }}
          className="w-9 flex items-center gap-0.5 hover:text-white transition-colors"
          title={lapOrder === "asc" ? "Show latest first" : "Show earliest first"}
        >
          LAP
          <svg className={`w-2.5 h-2.5 transition-transform ${lapOrder === "desc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <span className="w-[62px]">TIME</span>
        {SECTORS.map((s) => <span key={s} className="flex-1 text-right">{s}</span>)}
        <span className="w-5" />
      </div>
      {shownDriver && (() => {
        const list = [...(visibleLaps.get(shownDriver) || [])];
        if (lapOrder === "desc") list.reverse();
        if (list.length === 0) return <p className="py-2 text-[10px] text-f1-muted">No completed laps yet</p>;
        const best = bests.personalLap.get(shownDriver)?.lapNumber;
        return list.map((lap) => (
          <LapRow
            key={lap.lapNumber}
            lap={lap}
            bests={bests}
            selected={tab === "compare" ? lap.lapNumber === best : selectedLap[shownDriver] === lap.lapNumber}
            onClick={tab === "compare" ? undefined : () => toggleLap(shownDriver, lap.lapNumber)}
            lapClass={lap.lapTime && lap.kind !== "out"
              ? lapColorClass(lap.lapTime, lap.driver, lapData, currentTime, currentLap, false, false)
              : "text-f1-muted"}
          />
        ));
      })()}
    </div>
  );

  const rangeButtons = ranges.length > 1 && (
    <div className="flex items-center gap-1 px-3 pt-2 pb-1">
      {ranges.map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
            activeRange === r ? "bg-f1-red text-white" : "bg-f1-dark border border-f1-border text-f1-muted hover:text-white"
          }`}
        >
          {r === "Last 10" ? "Last 10 laps" : r}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-f1-card overflow-hidden">
      {onClose && (
        <div className="px-3 py-2 border-b border-f1-border flex-shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider">Lap Analysis</span>
          <button onClick={onClose} className="px-2 py-0.5 bg-f1-card/90 border border-f1-border rounded text-[9px] font-bold text-f1-muted hover:text-white transition-colors">
            Hide
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-shrink-0 border-b border-f1-border">
        {(["sectors", "compare"] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors border-b-2 ${
              tab === t ? "text-white border-f1-red" : "text-f1-muted border-transparent hover:text-white"
            }`}
          >
            {t === "sectors" ? "Sectors" : "Compare"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "sectors" ? (
          <>
            <BestsSummary bests={bests} drivers={sortedDrivers} onPickDriver={setDriver} selected={driver} />
            <div className="px-3 py-2 border-b border-f1-border">
              <DriverDropdown
                value={driver}
                onChange={setDriver}
                drivers={sortedDrivers}
                placeholder="Select a driver to see their laps..."
                getColor={getDriverColor}
              />
            </div>
            {driver && (
              <>
                {rangeButtons}
                {!isQualifying && (
                  chart.runs.length === 0 ? (
                    <div className="h-[40px] flex items-center justify-center text-[10px] text-f1-muted">No flying laps yet</div>
                  ) : (
                    <div className="px-2 pb-1">
                      <ResponsiveContainer width="100%" height={150}>
                        <ScatterChart margin={{ top: 5, right: 8, left: -10, bottom: 5 }}>
                          <XAxis
                            dataKey="x"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tick={{ fill: "#6B7280", fontSize: 8 }}
                            tickLine={false}
                            axisLine={{ stroke: "#374151" }}
                            tickFormatter={(v: number) => `${Math.round(v)}m`}
                          />
                          <YAxis
                            dataKey="y"
                            type="number"
                            domain={chart.domain}
                            allowDataOverflow
                            tick={{ fill: "#6B7280", fontSize: 9 }}
                            tickLine={false}
                            axisLine={{ stroke: "#374151" }}
                            tickFormatter={(v: number) => formatLapSecs(v)}
                          />
                          <Tooltip
                            cursor={false}
                            content={({ active: on, payload }) => {
                              const pt = on ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                              if (!pt?.lap) return null;
                              const lap = pt.lap;
                              return (
                                <div className="bg-[#1A1A26] border border-f1-border rounded-md px-2.5 py-1.5 text-[11px] shadow-xl">
                                  <div className="font-bold text-white">Lap {lap.lapNumber} · {fmt(lap.lapSecs)}</div>
                                  <div className="text-f1-muted tabular-nums">
                                    {lap.sectors.map((s, i) => `${SECTORS[i]} ${s === null ? "—" : s.toFixed(3)}`).join("  ")}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          {chart.runs.map((run, i) => (
                            <Scatter
                              key={`run-${i}`}
                              data={run.points}
                              line={{ stroke: getDriverColor(run.abbr), strokeWidth: 1.5 }}
                              shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={2.5} fill={getDriverColor(run.abbr)} />}
                              isAnimationActive={false}
                            />
                          ))}
                          {(() => {
                            const lap = lapOf(driver, selectedLap[driver]);
                            const pt = chart.runs.flatMap((r) => r.points).find((p) => p.lap === lap);
                            return pt ? (
                              <Scatter
                                data={[pt]}
                                shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={5} fill="none" stroke="#FFFFFF" strokeWidth={1.5} />}
                                isAnimationActive={false}
                              />
                            ) : null;
                          })()}
                        </ScatterChart>
                      </ResponsiveContainer>
                      <p className="px-1 text-[9px] text-f1-muted">Lap times through the session. Out, in and slow laps are left out.</p>
                    </div>
                  )
                )}
                {selectedLap[driver] !== undefined && lapOf(driver, selectedLap[driver]) ? (
                  <LapCard lap={lapOf(driver, selectedLap[driver])!} bests={bests} />
                ) : (
                  <p className="px-3 pt-1 pb-2 text-[10px] text-f1-muted">Click a lap to see each sector against the session&apos;s best.</p>
                )}
                {lapList}
              </>
            )}
          </>
        ) : (
          <>
            <div className="px-3 py-2 space-y-1.5 border-b border-f1-border">
              <DriverDropdown
                value={compare[0]}
                onChange={(abbr) => setCompare((prev) => [abbr, prev[1]])}
                drivers={sortedDrivers}
                placeholder="First driver..."
                getColor={getDriverColor}
              />
              <DriverDropdown
                value={compare[1]}
                onChange={(abbr) => setCompare((prev) => [prev[0], abbr])}
                drivers={sortedDrivers}
                placeholder="Compare with..."
                getColor={getDriverColor}
              />
            </div>
            {active.length < 2 ? (
              <div className="px-3 py-6 text-center text-xs text-f1-muted">Select two drivers to compare their laps</div>
            ) : (
              <>
                <div className="pt-2">
                  <div className="px-3 pb-1 text-[9px] font-bold text-f1-muted uppercase tracking-wider">Best laps</div>
                  <ComparisonCard
                    a={bestLap(active[0])}
                    b={bestLap(active[1])}
                    colorA={getDriverColor(active[0])}
                    colorB={getDriverColor(active[1])}
                    onShowLaps={(abbr) => { setDriver(abbr); switchTab("sectors"); }}
                  />
                </div>
                {desktop && (
                  <div className="mt-2 border-t border-f1-border pt-2 px-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-f1-muted uppercase tracking-wider">Best laps compared</span>
                      <button
                        onClick={() => setDominanceOn(!dominanceOn)}
                        disabled={!comparison}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors disabled:opacity-40 ${
                          dominanceOn ? "bg-f1-red text-white" : "bg-f1-dark border border-f1-border text-f1-muted hover:text-white"
                        }`}
                        title="Colour the track map by who was faster in each part of the lap"
                      >
                        Track dominance
                      </button>
                    </div>
                    {!traceKey ? null : traces?.key !== traceKey ? (
                      <p className="py-3 text-center text-[10px] text-f1-muted">Loading telemetry…</p>
                    ) : comparison ? (
                      <LapTraceChart comparison={comparison} nameA={active[0]} nameB={active[1]} colorA={colorA} colorB={colorB} />
                    ) : (
                      <p className="py-3 text-center text-[10px] text-f1-muted">Telemetry not available for these laps</p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LapRow({ lap, bests, selected, onClick, lapClass }: {
  lap: ParsedLap;
  bests: SessionBests;
  selected: boolean;
  /** Without it the row is display only */
  onClick?: () => void;
  lapClass: string;
}) {
  const muted = lap.kind !== "push";
  const tyreColor = lap.compound ? TYRE_COLORS[lap.compound] || "#888" : undefined;
  const tyreLabel = lap.compound ? TYRE_SHORT[lap.compound] || "?" : null;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full flex items-center gap-1 py-0.5 text-left rounded-sm transition-colors ${
        selected ? "bg-white/15" : onClick ? "hover:bg-white/5" : ""
      } ${muted ? "opacity-60" : ""} ${onClick ? "" : "cursor-default"}`}
    >
      <span className="w-9 text-[10px] font-bold text-f1-muted tabular-nums flex items-center gap-0.5">
        {lap.lapNumber}
        {muted && <span className="text-[7px] font-bold text-f1-muted">{lap.kind === "out" ? "OUT" : "IN"}</span>}
      </span>
      <span className={`w-[62px] text-[10px] font-bold tabular-nums ${muted ? "text-f1-muted" : lapClass === "text-f1-muted" ? "text-white" : lapClass}`}>
        {lap.lapTime || "—"}
      </span>
      {lap.sectors.map((s, i) => {
        const color = lap.kind === "out" ? null : sectorColor(s, lap.driver, i, bests);
        return (
          <span key={i} className={`flex-1 text-right text-[10px] tabular-nums ${color ? SECTOR_COLOR_CLASS[color] : "text-white/80"}`}>
            {s === null ? "—" : s.toFixed(3)}
          </span>
        );
      })}
      <span className="w-5 flex justify-end">
        {tyreLabel && (
          <span
            className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-extrabold leading-none border"
            style={{ borderColor: tyreColor, color: tyreColor }}
            title={lap.tyreLife != null ? `${lap.compound} · ${lap.tyreLife} laps old` : lap.compound ?? undefined}
          >
            {tyreLabel}
          </span>
        )}
      </span>
    </button>
  );
}

/** One lap's sectors against the session best and the driver's own best. */
function LapCard({ lap, bests }: { lap: ParsedLap; bests: SessionBests }) {
  const own = bests.personalSectors.get(lap.driver);
  const ownLap = bests.personalLap.get(lap.driver)?.secs ?? null;
  const rows = [
    ...SECTORS.map((label, i) => ({ label, value: lap.sectors[i], best: bests.sectors[i], own: own?.[i] ?? null, color: sectorColor(lap.sectors[i], lap.driver, i, bests) })),
    { label: "Lap", value: lap.lapSecs, best: bests.lap, own: ownLap, color: null },
  ];
  return (
    <div className="mx-3 mb-2 rounded border border-f1-border bg-f1-dark px-2 py-1.5">
      <div className="text-[9px] font-bold text-f1-muted uppercase tracking-wider mb-1">
        {lap.driver} · Lap {lap.lapNumber}{lap.kind !== "push" ? ` (${lap.kind === "out" ? "out lap" : "in lap"})` : ""}
      </div>
      <div className="grid grid-cols-[28px_1fr_1fr_1fr] gap-x-2 text-[10px] tabular-nums">
        <span />
        <span className="text-f1-muted text-[9px]">TIME</span>
        <span className="text-f1-muted text-[9px]">TO BEST</span>
        <span className="text-f1-muted text-[9px]">TO OWN BEST</span>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="text-f1-muted font-bold">{r.label}</span>
            <span className={`font-bold ${r.color ? SECTOR_COLOR_CLASS[r.color] : "text-white"}`}>
              {r.label === "Lap" ? fmt(r.value) : r.value?.toFixed(3) ?? "—"}
            </span>
            <span className={r.value !== null && r.best ? deltaClass(r.value - r.best.secs) : "text-f1-muted"}>
              {r.value !== null && r.best ? `${formatDelta(r.value - r.best.secs)} ${r.best.driver}` : "—"}
            </span>
            <span className={r.value !== null && r.own !== null ? deltaClass(r.value - r.own) : "text-f1-muted"}>
              {r.value !== null && r.own !== null ? formatDelta(r.value - r.own) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two drivers' best laps so far, side by side. */
function ComparisonCard({ a, b, colorA, colorB, onShowLaps }: {
  a: ParsedLap | undefined;
  b: ParsedLap | undefined;
  colorA: string;
  colorB: string;
  /** Open a driver's full lap list in the Sectors tab */
  onShowLaps: (abbr: string) => void;
}) {
  if (!a || !b) {
    return <p className="px-3 pb-2 text-[10px] text-f1-muted">Both drivers need a completed lap to compare.</p>;
  }
  const rows = [
    ...SECTORS.map((label, i) => ({ label, va: a.sectors[i], vb: b.sectors[i] })),
    { label: "Lap", va: a.lapSecs, vb: b.lapSecs },
  ];
  const lapLabel = (lap: ParsedLap) => `best, lap ${lap.lapNumber}`;
  return (
    <div className="mx-3 mb-2 rounded border border-f1-border bg-f1-dark px-2 py-1.5">
      <div className="grid grid-cols-[28px_1fr_1fr_56px] gap-x-2 text-[10px] tabular-nums">
        <span />
        {([[a, colorA], [b, colorB]] as const).map(([lap, color]) => (
          <button
            key={lap.driver}
            onClick={() => onShowLaps(lap.driver)}
            className="flex items-center gap-1 text-[9px] font-bold text-white hover:underline underline-offset-2 text-left"
            title={`See all of ${lap.driver}'s laps`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />{lap.driver}
            <span className="font-normal text-f1-muted">{lapLabel(lap)}</span>
          </button>
        ))}
        <span className="text-[9px] text-f1-muted text-right">DELTA</span>
        {rows.map((r) => {
          const d = r.va !== null && r.vb !== null ? r.va - r.vb : null;
          const show = (v: number | null) => (r.label === "Lap" ? fmt(v) : v?.toFixed(3) ?? "—");
          return (
            <div key={r.label} className="contents">
              <span className="font-bold text-f1-muted">{r.label}</span>
              <span className={d !== null && d < -0.0005 ? "text-white font-bold" : "text-white/70"}>{show(r.va)}</span>
              <span className={d !== null && d > 0.0005 ? "text-white font-bold" : "text-white/70"}>{show(r.vb)}</span>
              <span className={`text-right font-bold ${d !== null ? deltaClass(d) : "text-f1-muted"}`}>
                {d !== null ? formatDelta(d) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Best sectors, the theoretical best lap and each driver's ideal lap. */
function BestsSummary({ bests, drivers, onPickDriver, selected }: {
  bests: SessionBests;
  drivers: ReplayDriver[];
  onPickDriver: (abbr: string) => void;
  selected: string | null;
}) {
  const theoretical = theoreticalBest(bests);
  const ideals = drivers
    .map((d) => ({
      abbr: d.abbr,
      color: d.color,
      ideal: idealLap(d.abbr, bests),
      best: bests.personalLap.get(d.abbr)?.secs ?? null,
    }))
    .filter((r): r is typeof r & { ideal: number } => r.ideal !== null)
    .sort((x, y) => x.ideal - y.ideal);

  return (
    <div className="border-b border-f1-border">
      <div className="px-3 pt-2 pb-1 text-[9px] font-bold text-f1-muted uppercase tracking-wider">Best sectors &amp; ideal laps</div>
      <div className="px-3 pb-2">
          {bests.sectors.every((s) => s === null) ? (
            <p className="text-[10px] text-f1-muted py-1">No completed laps yet</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1 text-[10px] tabular-nums mb-2">
                {bests.sectors.map((s, i) => (
                  <div key={i} className="rounded bg-f1-dark px-1.5 py-1">
                    <div className="text-[8px] font-bold text-f1-muted">{SECTORS[i]}</div>
                    <div className="font-bold text-purple-400">{s ? s.secs.toFixed(3) : "—"}</div>
                    <div className="text-[9px] text-f1-muted">{s?.driver ?? ""}</div>
                  </div>
                ))}
                <div className="rounded bg-f1-dark px-1.5 py-1" title="The session's three best sectors added together">
                  <div className="text-[8px] font-bold text-f1-muted">THEORETICAL</div>
                  <div className="font-bold text-white">{theoretical !== null ? formatLapSecs(theoretical) : "—"}</div>
                  {theoretical !== null && bests.lap && (
                    <div className="text-[9px] text-f1-muted">{formatDelta(theoretical - bests.lap.secs)} to best</div>
                  )}
                </div>
              </div>
              {ideals.length > 0 && (
                <div className="text-[10px] tabular-nums">
                  <div className="grid grid-cols-[1fr_60px_60px_44px] gap-x-1 text-[8px] font-bold text-f1-muted pb-0.5 border-b border-f1-border">
                    <span>DRIVER</span>
                    <span className="text-right" title="Sum of the driver's best sectors">IDEAL</span>
                    <span className="text-right">BEST LAP</span>
                    <span className="text-right">GAP</span>
                  </div>
                  <div className="max-h-[140px] overflow-y-auto">
                    {ideals.map((r) => (
                      <button
                        key={r.abbr}
                        onClick={() => onPickDriver(r.abbr)}
                        className={`w-full grid grid-cols-[1fr_60px_60px_44px] gap-x-1 py-0.5 text-left transition-colors ${r.abbr === selected ? "bg-white/10" : "hover:bg-white/5"}`}
                        title={`Show ${r.abbr}'s laps`}
                      >
                        <span className="flex items-center gap-1 font-bold text-white">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.color }} />{r.abbr}
                        </span>
                        <span className="text-right text-white">{formatLapSecs(r.ideal)}</span>
                        <span className="text-right text-white/70">{r.best !== null ? formatLapSecs(r.best) : "—"}</span>
                        <span className="text-right text-f1-muted">{r.best !== null ? formatDelta(r.best - r.ideal) : "—"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
