"use client";

import { ReplayDriver } from "@/hooks/useReplaySocket";

interface Props {
  visible: boolean;
  driver: ReplayDriver | null;
  year?: number;
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
    <div className="flex items-end gap-[2px] h-[18px]">
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

export default function TelemetryChart({ visible, driver, year }: Props) {
  const hasDrs = !year || year < 2026;
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
    <div className="bg-f1-card/90 border border-f1-border rounded px-3 sm:px-4 py-1.5 backdrop-blur-sm">
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Driver */}
        <div className="w-[38px] sm:w-[42px] flex items-center gap-1 shrink-0">
          <span
            className="w-1 h-4 rounded-sm shrink-0"
            style={{ backgroundColor: driver.color }}
          />
          <span className="text-[10px] font-extrabold text-white">
            {driver.abbr}
          </span>
        </div>

        {/* Speed */}
        <div className="w-[50px] sm:w-[85px] flex items-center shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto">Spd</span>
          <span className="text-[11px] sm:text-xs font-extrabold text-white tabular-nums text-right w-[26px] sm:w-[26px]">
            {speed}
          </span>
          <span className="text-[8px] text-f1-muted hidden sm:inline ml-1">km/h</span>
        </div>

        {/* Throttle */}
        <div className="w-[52px] sm:w-[50px] flex items-center gap-[3px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto">Thr</span>
          <BarPips value={throttle} max={100} color="#22C55E" />
        </div>

        {/* Brake */}
        <div className="w-[52px] sm:w-[48px] flex items-center gap-[3px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[20px] sm:w-auto">Brk</span>
          <BarPips value={brake} max={100} color="#EF4444" />
        </div>

        {/* Gear */}
        <div className="w-[26px] sm:w-[38px] flex items-center gap-[2px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase w-[10px] sm:hidden">G</span>
          <span className="text-[9px] font-bold text-f1-muted uppercase hidden sm:inline">Gear</span>
          <span className="text-[11px] sm:text-xs font-extrabold text-white tabular-nums w-[10px] sm:w-[10px] text-center">
            {gear === 0 ? "N" : gear}
          </span>
        </div>

        {/* RPM */}
        <div className="w-[62px] sm:w-[90px] flex items-center gap-[5px] shrink-0">
          <span className="text-[9px] font-bold text-f1-muted uppercase hidden sm:inline">RPM</span>
          <span className="text-[10px] font-extrabold text-white tabular-nums text-right w-[28px] sm:w-[32px]">
            {Math.round(rpm / 100) / 10}k
          </span>
          <BarPips value={rpm} max={15000} color="#F59E0B" />
        </div>

        {/* DRS (not available from 2026) */}
        {hasDrs && (
          <span
            className={`w-[28px] sm:w-[32px] text-center text-[9px] font-extrabold py-0.5 rounded shrink-0 ${
              drs >= 10
                ? "text-green-400 bg-green-400/10 border border-green-400/30"
                : "text-f1-muted/40 border border-f1-border"
            }`}
          >
            DRS
          </span>
        )}
      </div>
    </div>
  );
}
