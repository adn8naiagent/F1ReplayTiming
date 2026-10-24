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
}

const AXIS = { fill: "#6B7280", fontSize: 8 };
const SYNC = "lap-trace";

/** The values at the hovered point, in a fixed line above the charts. */
function Readout({ p, nameA, nameB, colorA, colorB }: {
  p: TracePoint | null;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  if (!p) {
    return <div className="h-[34px] flex items-center px-1 text-[9px] text-f1-muted">Hover the charts to compare the two laps at any point</div>;
  }
  const driver = (name: string, color: string, speed: number, throttle: number, brake: number, gear: number) => (
    <span className="flex items-center gap-1 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-bold text-white">{name}</span>
      <span className="text-white">{Math.round(speed)}</span>
      <span className="text-f1-muted">km/h G{gear} {brake ? "brake" : `${Math.round(throttle)}%`}</span>
    </span>
  );
  return (
    <div className="h-[34px] px-1 text-[9px] leading-tight">
      <div className="flex items-center gap-2">
        <span className="text-f1-muted tabular-nums w-11">{(p.d / 1000).toFixed(2)} km</span>
        {driver(nameA, colorA, p.speedA, p.throttleA, p.brakeA, p.gearA)}
        {driver(nameB, colorB, p.speedB, p.throttleB, p.brakeB, p.gearB)}
      </div>
      <div className={`pl-[52px] tabular-nums ${p.delta < 0 ? "text-green-400" : p.delta > 0 ? "text-red-400" : "text-f1-muted"}`}>
        {nameA} {p.delta <= 0 ? "ahead" : "behind"} by {Math.abs(p.delta).toFixed(3)}s
      </div>
    </div>
  );
}

export default function LapTraceChart({ comparison, nameA, nameB, colorA, colorB }: Props) {
  const data = comparison.points;
  const maxD = data[data.length - 1]?.d ?? 0;
  const [hover, setHover] = useState<TracePoint | null>(null);
  // Only the cursor line: values go in the readout, not a pop-up per chart.
  const tooltip = <Tooltip cursor={{ stroke: "#6B7280", strokeWidth: 1 }} content={() => null} />;
  const hoverProps = {
    onMouseMove: (state: { activePayload?: { payload: TracePoint }[] }) => setHover(state?.activePayload?.[0]?.payload ?? null),
    onMouseLeave: () => setHover(null),
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
      <Readout p={hover} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
      {label("Gap (approx.)")}
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} syncId={SYNC} margin={margin} {...hoverProps}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />
          <ReferenceLine y={0} stroke="#4B5563" />
          {tooltip}
          <Line type="linear" dataKey="delta" stroke="#E5E7EB" strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {label("Speed")}
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} syncId={SYNC} margin={margin} {...hoverProps}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v: number) => `${Math.round(v)}`} />
          {tooltip}
          {lines("speed")}
        </LineChart>
      </ResponsiveContainer>
      {label("Throttle")}
      <ResponsiveContainer width="100%" height={45}>
        <LineChart data={data} syncId={SYNC} margin={margin} {...hoverProps}>
          {xAxis(false)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[0, 100]} ticks={[0, 100]} />
          {tooltip}
          {lines("throttle")}
        </LineChart>
      </ResponsiveContainer>
      {label("Brake")}
      <ResponsiveContainer width="100%" height={30}>
        <LineChart data={data} syncId={SYNC} margin={margin} {...hoverProps}>
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
        <LineChart data={data} syncId={SYNC} margin={{ ...margin, bottom: 2 }} {...hoverProps}>
          {xAxis(true)}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={Y_WIDTH} domain={[1, 8]} ticks={[1, 4, 8]} />
          {tooltip}
          {lines("gear", true)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
