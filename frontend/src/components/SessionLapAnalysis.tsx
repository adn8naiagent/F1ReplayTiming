"use client";

import { useState, useMemo, useEffect } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { ReplayDriver, QualiPhaseInfo } from "@/hooks/useReplaySocket";
import { LapEntry } from "@/components/Leaderboard";
import DriverDropdown from "@/components/DriverDropdown";
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
  onClose?: () => void;
}

const SECOND_DRIVER_COLOR = "#06B6D4"; // cyan, when both drivers share a team colour
const SECTORS = ["S1", "S2", "S3"] as const;

interface ChartPoint {
  x: number; // minutes into the session
  y: number;
  lap: ParsedLap;
}

function fmt(secs: number | null): string {
  return secs === null ? "—" : formatLapSecs(secs);
}

function deltaClass(delta: number): string {
  return delta < -0.0005 ? "text-green-400" : delta > 0.0005 ? "text-red-400" : "text-f1-muted";
}

export default function SessionLapAnalysis({
  laps, drivers, currentTime, currentLap, lapData, qualiPhases, isQualifying, onClose,
}: Props) {
  const [selectedDrivers, setSelectedDrivers] = useState<[string | null, string | null]>([null, null]);
  const [range, setRange] = useState<string>("All");
  const [listDriver, setListDriver] = useState<string | null>(null);
  const [selectedLap, setSelectedLap] = useState<Record<string, number>>({});
  const [summaryOpen, setSummaryOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("f1replay_lap_summary") !== "closed"; } catch { return true; }
  });
  const [lapOrder, setLapOrder] = useState<"asc" | "desc">(() => {
    try { return (localStorage.getItem("f1replay_lap_order") as "asc" | "desc") || "asc"; } catch { return "asc"; }
  });

  const sortedDrivers = useMemo(
    () => [...drivers].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [drivers],
  );
  const driverLaps = useMemo(() => parseLaps(laps), [laps]);
  const bests = useMemo(() => computeSessionBests(driverLaps, currentTime), [driverLaps, currentTime]);
  const active = selectedDrivers.filter((d): d is string => d !== null);

  function getDriverColor(abbr: string): string {
    const color = drivers.find((d) => d.abbr === abbr)?.color || "#888";
    if (active.length === 2 && abbr === active[1]) {
      const first = drivers.find((d) => d.abbr === active[0])?.color || "#888";
      if (first.toLowerCase() === color.toLowerCase()) return SECOND_DRIVER_COLOR;
    }
    return color;
  }

  // The lap list shows one driver at a time; follow the selection.
  const shownDriver = listDriver && active.includes(listDriver) ? listDriver : active[0] ?? null;

  // Forget selected laps that haven't happened yet (after seeking backwards).
  useEffect(() => {
    setSelectedLap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [abbr, lapNum] of Object.entries(prev)) {
        const lap = driverLaps.get(abbr)?.find((l) => l.lapNumber === lapNum);
        if (!lap || !isComplete(lap, currentTime) || !active.includes(abbr)) {
          delete next[abbr];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentTime, driverLaps, selectedDrivers]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Chart: push laps as lines (one line per run), out/in laps as hollow
  // markers along the top so slow laps don't squash the scale.
  const chart = useMemo(() => {
    const runs: { abbr: string; points: ChartPoint[] }[] = [];
    const slow: { abbr: string; points: ChartPoint[] }[] = [];
    let min = Infinity;
    let max = -Infinity;
    for (const abbr of active) {
      let run: ChartPoint[] = [];
      const slowPts: ChartPoint[] = [];
      for (const lap of visibleLaps.get(abbr) || []) {
        if (lap.lapSecs === null) continue;
        const pt = { x: lap.completedAt! / 60, y: lap.lapSecs, lap };
        if (lap.kind === "push") {
          run.push(pt);
          min = Math.min(min, lap.lapSecs);
          max = Math.max(max, lap.lapSecs);
        } else {
          if (run.length) runs.push({ abbr, points: run });
          run = [];
          slowPts.push(pt);
        }
      }
      if (run.length) runs.push({ abbr, points: run });
      slow.push({ abbr, points: slowPts });
    }
    if (min === Infinity) {
      for (const s of slow) for (const p of s.points) { min = Math.min(min, p.y); max = Math.max(max, p.y); }
    }
    const pad = (max - min) * 0.1 || 1;
    const domain: [number, number] = min === Infinity ? [0, 1] : [Math.max(0, min - pad), max + pad];
    // Out/in laps sit just under the top edge, keeping their real time for the tooltip.
    for (const s of slow) for (const p of s.points) p.y = Math.min(p.y, domain[1] - pad * 0.3);
    return { runs, slow, domain, empty: runs.length === 0 && slow.every((s) => s.points.length === 0) };
  }, [visibleLaps, active.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const lapOf = (abbr: string, lapNumber: number | undefined) =>
    lapNumber === undefined ? undefined : driverLaps.get(abbr)?.find((l) => l.lapNumber === lapNumber);

  // Laps for the cards: the selected lap, else the driver's best so far.
  const cardLap = (abbr: string): ParsedLap | undefined =>
    lapOf(abbr, selectedLap[abbr]) ?? lapOf(abbr, bests.personalLap.get(abbr)?.lapNumber);

  const toggleLap = (abbr: string, lapNumber: number) =>
    setSelectedLap((prev) => {
      const next = { ...prev };
      if (next[abbr] === lapNumber) delete next[abbr];
      else next[abbr] = lapNumber;
      return next;
    });

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

      <div className="flex-1 overflow-y-auto min-h-0">
        <BestsSummary
          bests={bests}
          drivers={sortedDrivers}
          open={summaryOpen}
          onToggle={() => {
            const next = !summaryOpen;
            setSummaryOpen(next);
            try { localStorage.setItem("f1replay_lap_summary", next ? "open" : "closed"); } catch {}
          }}
          onPickDriver={(abbr) => setSelectedDrivers((prev) => [abbr, prev[1] === abbr ? null : prev[1]])}
        />

        {/* Driver selectors */}
        <div className="px-3 py-2 space-y-1.5 border-b border-f1-border">
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

        {active.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-f1-muted">Select a driver to view lap times</div>
        ) : (
          <>
            {/* Range + chart */}
            <div className="px-2 pt-2 pb-1">
              <div className="flex items-center gap-1 mb-2">
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
              {chart.empty ? (
                <div className="h-[60px] flex items-center justify-center text-[10px] text-f1-muted">No completed laps yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={170}>
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
                    {isQualifying && activeRange === "All" && qualiPhases.slice(1)
                      .filter((p) => p.timestamp <= currentTime)
                      .map((p) => (
                        <ReferenceLine key={p.phase} x={p.timestamp / 60} stroke="#4B5563" strokeDasharray="3 3"
                          label={{ value: p.phase, fill: "#6B7280", fontSize: 8, position: "insideTopLeft" }} />
                      ))}
                    <Tooltip
                      cursor={false}
                      content={({ active: on, payload }) => {
                        const pt = on ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                        if (!pt?.lap) return null;
                        const lap = pt.lap;
                        return (
                          <div className="bg-[#1A1A26] border border-f1-border rounded-md px-2.5 py-1.5 text-[11px] shadow-xl">
                            <div className="flex items-center gap-1.5 font-bold text-white">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDriverColor(lap.driver) }} />
                              {lap.driver} · Lap {lap.lapNumber}
                              {lap.kind !== "push" && <span className="text-f1-muted font-normal">{lap.kind === "out" ? "Out lap" : "In lap"}</span>}
                            </div>
                            <div className="text-white tabular-nums">{fmt(lap.lapSecs)}</div>
                            <div className="text-f1-muted tabular-nums">
                              {lap.sectors.map((s, i) => `${SECTORS[i]} ${s === null ? "—" : s.toFixed(3)}`).join("  ")}
                            </div>
                          </div>
                        );
                      }}
                    />
                    {chart.runs.map((run, i) => (
                      <Scatter
                        key={`run-${run.abbr}-${i}`}
                        data={run.points}
                        fill={getDriverColor(run.abbr)}
                        line={{ stroke: getDriverColor(run.abbr), strokeWidth: 1.5 }}
                        shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={2.5} fill={getDriverColor(run.abbr)} />}
                        isAnimationActive={false}
                      />
                    ))}
                    {chart.slow.map((s) => (
                      <Scatter
                        key={`slow-${s.abbr}`}
                        data={s.points}
                        shape={(p: { cx?: number; cy?: number }) => (
                          <circle cx={p.cx} cy={p.cy} r={2.5} fill="none" stroke={getDriverColor(s.abbr)} strokeOpacity={0.6} />
                        )}
                        isAnimationActive={false}
                      />
                    ))}
                    {active.map((abbr) => {
                      const lap = lapOf(abbr, selectedLap[abbr]);
                      const pt = [...chart.runs, ...chart.slow].flatMap((r) => r.points).find((p) => p.lap === lap);
                      return pt ? (
                        <Scatter
                          key={`sel-${abbr}`}
                          data={[pt]}
                          shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={5} fill="none" stroke="#FFFFFF" strokeWidth={1.5} />}
                          isAnimationActive={false}
                        />
                      ) : null;
                    })}
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Lap card (one driver) or comparison (two) */}
            {active.length === 1 ? (
              selectedLap[active[0]] !== undefined && cardLap(active[0]) ? (
                <LapCard lap={cardLap(active[0])!} bests={bests} />
              ) : (
                <p className="px-3 pb-2 text-[10px] text-f1-muted">Select a lap to compare its sectors with the session&apos;s best.</p>
              )
            ) : (
              <ComparisonCard
                a={cardLap(active[0])}
                b={cardLap(active[1])}
                colorA={getDriverColor(active[0])}
                colorB={getDriverColor(active[1])}
                pickedA={selectedLap[active[0]] !== undefined}
                pickedB={selectedLap[active[1]] !== undefined}
              />
            )}

            {/* Lap list */}
            <div className="px-3 pb-2">
              {active.length === 2 && (
                <div className="flex gap-1 mb-1">
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
                return list.map((lap) => (
                  <LapRow
                    key={lap.lapNumber}
                    lap={lap}
                    bests={bests}
                    selected={selectedLap[shownDriver] === lap.lapNumber}
                    onClick={() => toggleLap(shownDriver, lap.lapNumber)}
                    lapClass={lap.lapTime && lap.kind !== "out"
                      ? lapColorClass(lap.lapTime, lap.driver, lapData, currentTime, currentLap, false, false)
                      : "text-f1-muted"}
                  />
                ));
              })()}
            </div>
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
  onClick: () => void;
  lapClass: string;
}) {
  const muted = lap.kind !== "push";
  const tyreColor = lap.compound ? TYRE_COLORS[lap.compound] || "#888" : undefined;
  const tyreLabel = lap.compound ? TYRE_SHORT[lap.compound] || "?" : null;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1 py-0.5 text-left rounded-sm transition-colors ${
        selected ? "bg-white/15" : "hover:bg-white/5"
      } ${muted ? "opacity-60" : ""}`}
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

/** Two laps side by side: each driver's selected lap, or best lap so far. */
function ComparisonCard({ a, b, colorA, colorB, pickedA, pickedB }: {
  a: ParsedLap | undefined;
  b: ParsedLap | undefined;
  colorA: string;
  colorB: string;
  pickedA: boolean;
  pickedB: boolean;
}) {
  if (!a || !b) {
    return <p className="px-3 pb-2 text-[10px] text-f1-muted">Both drivers need a completed lap to compare.</p>;
  }
  const rows = [
    ...SECTORS.map((label, i) => ({ label, va: a.sectors[i], vb: b.sectors[i] })),
    { label: "Lap", va: a.lapSecs, vb: b.lapSecs },
  ];
  const sectorDeltas = SECTORS.map((_, i) =>
    a.sectors[i] !== null && b.sectors[i] !== null ? a.sectors[i]! - b.sectors[i]! : null,
  );
  // Where the gap came from: the sector with the biggest difference.
  let decisive: number | null = null;
  sectorDeltas.forEach((d, i) => {
    if (d !== null && (decisive === null || Math.abs(d) > Math.abs(sectorDeltas[decisive]!))) decisive = i;
  });
  const lapLabel = (lap: ParsedLap, picked: boolean) => `Lap ${lap.lapNumber}${picked ? "" : " (best)"}`;
  return (
    <div className="mx-3 mb-2 rounded border border-f1-border bg-f1-dark px-2 py-1.5">
      <div className="grid grid-cols-[28px_1fr_1fr_56px] gap-x-2 text-[10px] tabular-nums">
        <span />
        <span className="flex items-center gap-1 text-[9px] font-bold text-white">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorA }} />{a.driver}
          <span className="font-normal text-f1-muted">{lapLabel(a, pickedA)}</span>
        </span>
        <span className="flex items-center gap-1 text-[9px] font-bold text-white">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorB }} />{b.driver}
          <span className="font-normal text-f1-muted">{lapLabel(b, pickedB)}</span>
        </span>
        <span className="text-[9px] text-f1-muted text-right">DELTA</span>
        {rows.map((r, i) => {
          const d = r.va !== null && r.vb !== null ? r.va - r.vb : null;
          const show = (v: number | null) => (r.label === "Lap" ? fmt(v) : v?.toFixed(3) ?? "—");
          return (
            <div key={r.label} className="contents">
              <span className={`font-bold ${i === decisive ? "text-white" : "text-f1-muted"}`}>{r.label}</span>
              <span className={d !== null && d < -0.0005 ? "text-white font-bold" : "text-white/70"}>{show(r.va)}</span>
              <span className={d !== null && d > 0.0005 ? "text-white font-bold" : "text-white/70"}>{show(r.vb)}</span>
              <span className={`text-right font-bold ${d !== null ? deltaClass(d) : "text-f1-muted"}`}>
                {d !== null ? formatDelta(d) : "—"}
              </span>
            </div>
          );
        })}
      </div>
      {decisive !== null && sectorDeltas[decisive] !== null && Math.abs(sectorDeltas[decisive]!) > 0.0005 && (
        <p className="mt-1 text-[9px] text-f1-muted">
          Biggest difference in {SECTORS[decisive]}: {sectorDeltas[decisive]! < 0 ? a.driver : b.driver} faster by{" "}
          {Math.abs(sectorDeltas[decisive]!).toFixed(3)}s. Select laps in each driver&apos;s list to compare others.
        </p>
      )}
    </div>
  );
}

/** Best sectors, the theoretical best lap and each driver's ideal lap. */
function BestsSummary({ bests, drivers, open, onToggle, onPickDriver }: {
  bests: SessionBests;
  drivers: ReplayDriver[];
  open: boolean;
  onToggle: () => void;
  onPickDriver: (abbr: string) => void;
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
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/5 transition-colors">
        <span className="text-[9px] font-bold text-f1-muted uppercase tracking-wider">Best sectors &amp; ideal laps</span>
        <svg className={`w-3 h-3 text-f1-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
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
                        className="w-full grid grid-cols-[1fr_60px_60px_44px] gap-x-1 py-0.5 text-left hover:bg-white/5 transition-colors"
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
      )}
    </div>
  );
}
