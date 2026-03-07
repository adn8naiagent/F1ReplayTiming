"use client";

import { ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  visible: boolean;
  driver: ReplayDriver | null;
}

function BarPips({
  value,
  max,
  color,
  pips = 5,
}: {
  value: number;
  max: number;
  color: string;
  pips?: number;
}) {
  const filled = Math.round((value / max) * pips);
  return (
    <div className="flex items-end gap-[2px]">
      {Array.from({ length: pips }, (_, i) => {
        const h = 6 + i * 3; // ascending heights: 6, 9, 12, 15, 18
        const active = i < filled;
        return (
          <div
            key={i}
            className="w-[4px] rounded-[1px] transition-colors duration-100"
            style={{
              height: `${h}px`,
              backgroundColor: active ? color : "#3A3A4A",
            }}
          />
        );
      })}
    </div>
  );
}

export default function TelemetryChart({ visible, driver }: Props) {
  if (!visible) return null;

  if (!driver) {
    return (
      <div className="bg-f1-card/90 border border-f1-border rounded px-4 py-1.5 backdrop-blur-sm">
        <p className="text-[10px] text-f1-muted">
          Select 1–2 drivers to view telemetry
        </p>
      </div>
    );
  }

  const speed = Math.round(driver.speed ?? 0);
  const throttle = driver.throttle ?? 0;
  const brake = driver.brake ? 100 : 0;
  const gear = driver.gear ?? 0;
  const rpm = driver.rpm ?? 0;
  const drs = driver.drs ?? 0;

  return (
    <div className="bg-f1-card/90 border border-f1-border rounded px-4 py-1.5 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        {/* Driver */}
        <div className="flex items-center gap-1.5 w-[42px] shrink-0">
          <span
            className="w-1 h-4 rounded-sm shrink-0"
            style={{ backgroundColor: driver.color }}
          />
          <span className="text-[10px] font-extrabold text-white">
            {driver.abbr}
          </span>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-1 w-[85px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase">Spd</span>
          <span className="text-xs font-extrabold text-white tabular-nums w-[26px] text-right">
            {speed}
          </span>
          <span className="text-[8px] text-f1-muted">km/h</span>
        </div>

        {/* Throttle */}
        <div className="flex items-center gap-1 w-[50px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase">Thr</span>
          <BarPips value={throttle} max={100} color="#22C55E" />
        </div>

        {/* Brake */}
        <div className="flex items-center gap-1 w-[48px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase">Brk</span>
          <BarPips value={brake} max={100} color="#EF4444" />
        </div>

        {/* Gear */}
        <div className="flex items-center gap-1 w-[38px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase">Gear</span>
          <span className="text-xs font-extrabold text-white tabular-nums w-[10px] text-center">
            {gear === 0 ? "N" : gear}
          </span>
        </div>

        {/* RPM */}
        <div className="flex items-center gap-1 w-[90px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase">RPM</span>
          <span className="text-[10px] font-extrabold text-white tabular-nums w-[32px] text-right">
            {Math.round(rpm / 100) / 10}k
          </span>
          <BarPips value={rpm} max={15000} color="#F59E0B" />
        </div>

        {/* DRS */}
        <span
          className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
            drs >= 10
              ? "text-green-400 bg-green-400/10 border border-green-400/30"
              : "text-f1-muted/40 border border-f1-border"
          }`}
        >
          DRS
        </span>
      </div>
    </div>
  );
}
