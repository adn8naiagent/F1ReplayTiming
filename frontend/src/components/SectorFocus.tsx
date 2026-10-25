"use client";

import type { ReplayDriver } from "@/hooks/useReplaySocket";

// Whose sectors the track map shows with Show Sectors on: the driver picked
// here, else the first selected driver, else the leader. So it always shows
// someone, and selecting one driver is enough.

export function sectorTarget(focus: string | null, selected: string[], drivers: ReplayDriver[]): string | null {
  if (focus && selected.includes(focus)) return focus;
  if (selected.length > 0) return selected[0];
  return drivers.find((d) => d.position === 1)?.abbr ?? null;
}

/** The driver whose sectors are shown; with two selected, buttons to switch. */
export default function SectorFocusChips({ selected, drivers, target, onPick }: {
  selected: string[];
  drivers: ReplayDriver[];
  target: string | null;
  onPick: (abbr: string) => void;
}) {
  const chip = (abbr: string, active: boolean, label?: string, onClick?: () => void, title?: string) => {
    const drv = drivers.find((d) => d.abbr === abbr);
    return (
      <button
        key={abbr}
        onClick={onClick}
        disabled={!onClick}
        title={title}
        className={`flex-shrink-0 px-1.5 py-1 border rounded text-[10px] font-bold transition-colors backdrop-blur-sm ${
          active
            ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
            : "bg-f1-card/90 border-f1-border text-f1-muted hover:text-white"
        } ${onClick ? "" : "cursor-default"}`}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: drv?.color }} />
        {abbr}
        {label && <span className="ml-1 font-normal text-purple-300/70">{label}</span>}
      </button>
    );
  };

  if (!target) return null;
  if (selected.length === 0) {
    return chip(target, true, "Leader", undefined, "Select a driver on the leaderboard to show theirs");
  }
  if (selected.length === 1) return chip(target, true);
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {selected.map((abbr) => chip(abbr, abbr === target, undefined, () => onPick(abbr)))}
    </div>
  );
}
