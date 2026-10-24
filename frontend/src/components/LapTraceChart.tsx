"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { LapComparison, TracePoint } from "@/lib/lapCompare";

// Two laps' telemetry along the lap: speed, throttle, brake, gear and the
// running time gap. The charts share a hover position (syncId), and one
// readout above them shows the values there.

interface Props {
  comparison: LapComparison;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
  /** Corners along the lap (0–1), shown on the distance axis */
  corners?: { frac: number; label: string }[];
}

const AXIS = { fill: "#6B7280", fontSize: 8 };

type TraceKey = "gap" | "speed" | "throttle" | "brake" | "gear";
const TRACES: { key: TraceKey; label: string; height: number }[] = [
  { key: "gap", label: "Gap", height: 60 },
  { key: "speed", label: "Speed", height: 85 },
  { key: "throttle", label: "Throttle", height: 40 },
  { key: "brake", label: "Brake", height: 26 },
  { key: "gear", label: "Gear", height: 40 },
];
const DEFAULT_TRACES: TraceKey[] = ["gap", "speed", "throttle"];
const SYNC = "lap-trace";

/** The values at the hovered (or touched) point, in a fixed table above the charts. */
function Readout({ p, nameA, nameB, colorA, colorB }: {
  p: TracePoint | null;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  const head = "text-[8px] font-bold text-f1-muted uppercase tracking-wider";
  const row = (name: string, color: string, speed: number, gear: number, throttle: number, brake: number) => (
    <div className="contents">
      <span className="flex items-center gap-1 font-bold text-white">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />{name}
      </span>
      <span className="text-right text-white">{p ? `${Math.round(speed)} km/h` : "—"}</span>
      <span className="text-right text-white">{p ? gear : "—"}</span>
      <span className="text-right text-white">{p ? `${Math.round(throttle)}%` : "—"}</span>
      <span className={`text-right ${p && brake ? "text-red-400 font-bold" : "text-f1-muted"}`}>{p ? (brake ? "On" : "Off") : "—"}</span>
    </div>
  );
  return (
    <div className="rounded border border-f1-border bg-f1-dark px-2 py-1.5 text-[10px] tabular-nums">
      <div className="grid grid-cols-[1fr_64px_36px_56px_36px] gap-x-1 gap-y-0.5 items-center">
        <span className={head}>{p ? `At ${(p.d / 1000).toFixed(2)} km` : "Point on lap"}</span>
        <span className={`${head} text-right`}>Speed</span>
        <span className={`${head} text-right`}>Gear</span>
        <span className={`${head} text-right`}>Throttle</span>
        <span className={`${head} text-right`}>Brake</span>
        {row(nameA, colorA, p?.speedA ?? 0, p?.gearA ?? 0, p?.throttleA ?? 0, p?.brakeA ?? 0)}
        {row(nameB, colorB, p?.speedB ?? 0, p?.gearB ?? 0, p?.throttleB ?? 0, p?.brakeB ?? 0)}
      </div>
      <div className={`mt-1 ${p ? (p.delta < 0 ? "text-green-400" : p.delta > 0 ? "text-red-400" : "text-f1-muted") : "text-f1-muted"}`}>
        {p
          ? `${nameA} ${p.delta <= 0 ? "ahead" : "behind"} by ${Math.abs(p.delta).toFixed(3)}s at this point`
          : "Hover, tap or drag along the charts to see both laps at that point"}
      </div>
    </div>
  );
}

export default function LapTraceChart({ comparison, nameA, nameB, colorA, colorB, corners = [] }: Props) {
  const data = comparison.points;
  const maxD = data[data.length - 1]?.d ?? 0;
  // Chart x is metres along lap A, so corner fractions scale by its length.
  const cornerMarks = corners.map((c) => ({ d: c.frac * maxD, label: `T${c.label}` }));
  // Labels need room: skip one that's too close to the last one shown (the
  // guide line still draws).
  const cornerTicks: typeof cornerMarks = [];
  for (const c of cornerMarks) {
    const last = cornerTicks[cornerTicks.length - 1];
    if (!last || c.d - last.d >= maxD * 0.045) cornerTicks.push(c);
  }
  const cornerLines = cornerMarks.map((c) => (
    <ReferenceLine key={`c${c.label}`} x={c.d} stroke="#374151" strokeOpacity={0.6} strokeDasharray="2 3" />
  ));
  const [hover, setHover] = useState<TracePoint | null>(null);
  // Only the cursor line: values go in the readout, not a pop-up per chart.
  const tooltip = <Tooltip cursor={{ stroke: "#6B7280", strokeWidth: 1 }} content={() => null} />;
  // Mouse: follows the pointer and clears when it leaves. Touch: Recharts
  // turns a drag into mouse moves and a tap into a press; the readout keeps
  // the last point touched, since touch has no "leave".
  type ChartState = { activePayload?: { payload: TracePoint }[] } | null;
  const pick = (state: ChartState) => {
    const p = state?.activePayload?.[0]?.payload;
    if (p) setHover(p);
  };
  const hoverProps = {
    onMouseMove: pick,
    onMouseDown: pick,
    onMouseLeave: () => {
      if (!window.matchMedia("(pointer: coarse)").matches) setHover(null);
    },
  };
  const xAxis = (show: boolean) => (
    <XAxis
      dataKey="d"
      type="number"
      domain={[0, maxD]}
      hide={!show}
      tick={AXIS}
      tickLine={false}
      axisLine={{ stroke: "#374151" }}
      ticks={cornerTicks.length ? cornerTicks.map((c) => c.d) : undefined}
      interval={0}
      tickFormatter={(v: number) => cornerTicks.find((c) => c.d === v)?.label ?? `${(v / 1000).toFixed(1)}km`}
    />
  );
  const label = (text: string) => <div className="px-1 text-[8px] font-bold text-f1-muted uppercase tracking-wider">{text}</div>;
  const margin = { top: 4, right: 8, left: 0, bottom: 0 };
  // An array, not a fragment: Recharts only finds direct children.
  const lines = (key: "speed" | "throttle" | "gear", step = false) => [
    <Line key={`${key}A`} type={step ? "stepAfter" : "linear"} dataKey={`${key}A`} stroke={colorA} strokeWidth={1.2} dot={false} isAnimationActive={false} />,
    <Line key={`${key}B`} type={step ? "stepAfter" : "linear"} dataKey={`${key}B`} stroke={colorB} strokeWidth={1.2} dot={false} isAnimationActive={false} />,
  ];
  const Y_WIDTH = 38;

  // Which traces to show; the panel isn't tall enough for all five at once.
  const [shown, setShown] = useState<TraceKey[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("f1replay_lap_traces") || "null");
      if (Array.isArray(saved) && saved.every((k) => TRACES.some((t) => t.key === k))) return saved;
    } catch {}
    return DEFAULT_TRACES;
  });
  const toggle = (key: TraceKey) => {
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : TRACES.map((t) => t.key).filter((k) => k === key || shown.includes(k));
    setShown(next);
    try { localStorage.setItem("f1replay_lap_traces", JSON.stringify(next)); } catch {}
  };

  const chart = (key: TraceKey, withAxis: boolean) => {
    const m = withAxis ? { ...margin, bottom: 2 } : margin;
    switch (key) {
      case "gap":
        return (
          <LineChart data={data} syncId={SYNC} margin={m} {...hoverProps}>
            {xAxis(withAxis)}
            {cornerLines}
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />
            <ReferenceLine y={0} stroke="#4B5563" />
            {tooltip}
            <Line type="linear" dataKey="delta" stroke="#E5E7EB" strokeWidth={1.2} dot={false} isAnimationActive={false} />
          </LineChart>
        );
      case "speed":
        return (
          <LineChart data={data} syncId={SYNC} margin={m} {...hoverProps}>
            {xAxis(withAxis)}
            {cornerLines}
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v: number) => `${Math.round(v)}`} />
            {tooltip}
            {lines("speed")}
          </LineChart>
        );
      case "throttle":
        return (
          <LineChart data={data} syncId={SYNC} margin={m} {...hoverProps}>
            {xAxis(withAxis)}
            {cornerLines}
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, 100]} ticks={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            {tooltip}
            {lines("throttle")}
          </LineChart>
        );
      case "brake":
        return (
          <LineChart data={data} syncId={SYNC} margin={m} {...hoverProps}>
            {xAxis(withAxis)}
            {cornerLines}
            <YAxis tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, 2.2]} tick={false} />
            {tooltip}
            {/* B drawn above A so both are visible when they brake together */}
            <Line type="stepAfter" dataKey="brakeA" stroke={colorA} strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey={(p: TracePoint) => p.brakeB + 1.1} stroke={colorB} strokeWidth={1.2} dot={false} isAnimationActive={false} />
          </LineChart>
        );
      case "gear":
        return (
          <LineChart data={data} syncId={SYNC} margin={m} {...hoverProps}>
            {xAxis(withAxis)}
            {cornerLines}
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[1, 8]} ticks={[1, 4, 8]} />
            {tooltip}
            {lines("gear", true)}
          </LineChart>
        );
    }
  };

  const visible = TRACES.filter((t) => shown.includes(t.key));
  return (
    <div className="space-y-1" style={{ touchAction: "pan-y" }}>
      <div className="flex flex-wrap items-center gap-1 pb-1">
        {TRACES.map((t) => (
          <button
            key={t.key}
            onClick={() => toggle(t.key)}
            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
              shown.includes(t.key) ? "bg-white/15 text-white" : "bg-f1-dark border border-f1-border text-f1-muted hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {visible.length > 0 && <Readout p={hover} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />}
      {visible.map((t, i) => {
        const withAxis = i === visible.length - 1;
        return (
          <div key={t.key}>
            {label(t.key === "gap" ? "Gap (approx.)" : t.label)}
            <ResponsiveContainer width="100%" height={t.height + (withAxis ? 16 : 0)}>
              {chart(t.key, withAxis)}
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
