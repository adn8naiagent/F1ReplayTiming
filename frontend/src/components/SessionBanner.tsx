"use client";

import { useState, useRef, useEffect } from "react";
import { ReplaySettings } from "@/hooks/useSettings";

interface Props {
  eventName: string;
  circuit: string;
  country: string;
  sessionType: string;
  year: number;
  settings: ReplaySettings;
  onSettingChange: (key: keyof ReplaySettings, value: boolean) => void;
}

const SESSION_LABELS: Record<string, string> = {
  R: "Race",
  Q: "Qualifying",
  S: "Sprint",
  SQ: "Sprint Qualifying",
  FP1: "Practice 1",
  FP2: "Practice 2",
  FP3: "Practice 3",
};

const SETTING_LABELS: { key: keyof ReplaySettings; label: string }[] = [
  { key: "showTyreType", label: "Tyre type" },
  { key: "showTyreAge", label: "Tyre age" },
  { key: "showPitStops", label: "Pit stops" },
  { key: "showGridChange", label: "Grid position change" },
  { key: "showSessionTime", label: "Total session time" },
];

export default function SessionBanner({
  eventName,
  circuit,
  country,
  sessionType,
  year,
  settings,
  onSettingChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="bg-f1-card border-b border-f1-border px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <a href="/" className="flex-shrink-0">
          <img src="/logo.png" alt="Home" className="w-10 h-10 rounded-lg hover:opacity-80 transition-opacity" />
        </a>
        <div>
          <h1 className="text-lg font-bold text-white">
            {year} {eventName}
          </h1>
          <p className="text-sm text-f1-muted">
            {circuit}, {country}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="bg-f1-red px-4 py-1 rounded text-white font-bold text-sm uppercase">
          {SESSION_LABELS[sessionType] || sessionType}
        </div>

        {/* Settings */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(!open)}
            className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-f1-card border border-f1-border rounded-lg shadow-xl z-50 py-2">
              <p className="px-4 py-1.5 text-xs font-bold text-f1-muted uppercase tracking-wider">
                Display
              </p>
              {SETTING_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onSettingChange(key, !settings[key])}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-white">{label}</span>
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      settings[key] ? "bg-f1-red" : "bg-f1-border"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings[key] ? "translate-x-[18px]" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
