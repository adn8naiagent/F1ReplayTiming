"use client";

import { useState, useRef, useEffect } from "react";
import { ReplayDriver } from "@/hooks/useReplaySocket";

export default function DriverDropdown({ value, onChange, drivers, placeholder, getColor }: {
  value: string | null;
  onChange: (abbr: string | null) => void;
  drivers: ReplayDriver[];
  placeholder: string;
  getColor: (abbr: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = drivers.find((d) => d.abbr === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-left hover:border-f1-muted transition-colors"
      >
        {selected ? (
          <>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(selected.abbr) }} />
            <span className="text-xs font-bold text-white">{selected.abbr}</span>
            <span className="text-[10px] text-f1-muted truncate">{selected.team}</span>
          </>
        ) : (
          <span className="text-xs text-f1-muted">{placeholder}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-f1-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-f1-dark border border-f1-border rounded shadow-xl z-50 max-h-[200px] overflow-y-auto">
          {value && (
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-f1-muted hover:bg-white/5 transition-colors"
            >
              Clear
            </button>
          )}
          {drivers.map((d) => (
            <button
              key={d.abbr}
              onClick={() => { onChange(d.abbr); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors ${
                d.abbr === value ? "bg-white/10" : ""
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[10px] font-bold text-f1-muted w-4 text-right">{d.position}</span>
              <span className="text-xs font-bold text-white">{d.abbr}</span>
              <span className="text-[10px] text-f1-muted truncate">{d.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
