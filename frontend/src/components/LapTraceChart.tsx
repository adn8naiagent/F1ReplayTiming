"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { LapComparison, TracePoint } from "@/lib/lapCompare";

// Two laps' telemetry along the lap: speed, throttle, brake, gear and the
// running time gap. The charts share a hover position (syncId).

interface Props {
  comparison: LapComparison;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}

const AXIS = { fill: "#6B7280", fontSize: 8 };
const SYNC = "lap-trace";

function TraceTooltip({ active, payload, nameA, nameB, colorA, colorB }: {
  active?: boolean;
  payload?: { payload: TracePoint }[];
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const row = (name: string, color: string, speed: number, throttle: number, brake: number, gear: number) => (
    <div className="flex items-center gap-1.5 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-f1-muted w-7">{name}</span>
      <span className="text-white w-14">{Math.round(speed)} km/h</span>
      <span className="text-f1-muted">G{gear} · {Math.round(throttle)}%{brake ? " · brake" : ""}</span>
    </div>
  );
  return (
    <div className="bg-[#1A1A26] border border-f1-border rounded-md px-2 py-1 text-[10px] shadow-xl">
      <div className="text-f1-muted mb-0.5">{Math.round(p.d)} m</div>
      {row(nameA, colorA, p.speedA, p.throttleA, p.brakeA, p.gearA)}
      {row(nameB, colorB, p.speedB, p.throttleB, p.brakeB, p.gearB)}
      <div className={`mt-0.5 tabular-nums ${p.delta < 0 ? "text-green-400" : p.delta > 0 ? "text-red-400" : "text-f1-muted"}`}>
        {nameA} {p.delta <= 0 ? "ahead" : "behind"} by {Math.abs(p.delta).toFixed(3)}s
      </div>
    </div>
  );
}

export default function LapTraceChart({ comparison, nameA, nameB, colorA, colorB }: Props) {
  const data = comparison.points;
  const maxD = data[data.length - 1]?.d ?? 0;
  const tooltip = (
    <Tooltip
      cursor={{ stroke: "#6B7280", strokeWidth: 1 }}
      content={(props) => (
        <TraceTooltip {...(props as { active?: boolean; payload?: { payload: TracePoint }[] })}
          nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
      )}
    />
  );
  const xAxis = (show: boolean) => (
    <XAxis
      dataKey="d"
      type="number"
      domain={[0, maxD]}
      hide={!show}
      tick={AXIS}
      tickLine={false}
      axisLine={{ stroke: "#374151" }}
      tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`}
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

  return (
    <div className="space-y-1">
      {label("Gap (approx.)")}
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} syncId={SYNC} margin={margin}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />
          <ReferenceLine y={0} stroke="#4B5563" />
          {tooltip}
          <Line type="linear" dataKey="delta" stroke="#E5E7EB" strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {label("Speed")}
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} syncId={SYNC} margin={margin}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v: number) => `${Math.round(v)}`} />
          {tooltip}
          {lines("speed")}
        </LineChart>
      </ResponsiveContainer>
      {label("Throttle")}
      <ResponsiveContainer width="100%" height={45}>
        <LineChart data={data} syncId={SYNC} margin={margin}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, 100]} ticks={[0, 100]} />
          {tooltip}
          {lines("throttle")}
        </LineChart>
      </ResponsiveContainer>
      {label("Brake")}
      <ResponsiveContainer width="100%" height={30}>
        <LineChart data={data} syncId={SYNC} margin={margin}>
          {xAxis(false)}
          <YAxis tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, 2.2]} tick={false} />
          {tooltip}
          {/* B drawn above A so both are visible when they brake together */}
          <Line type="stepAfter" dataKey="brakeA" stroke={colorA} strokeWidth={1.2} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey={(p: TracePoint) => p.brakeB + 1.1} stroke={colorB} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {label("Gear")}
      <ResponsiveContainer width="100%" height={55}>
        <LineChart data={data} syncId={SYNC} margin={{ ...margin, bottom: 2 }}>
          {xAxis(true)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[1, 8]} ticks={[1, 4, 8]} />
          {tooltip}
          {lines("gear", true)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
