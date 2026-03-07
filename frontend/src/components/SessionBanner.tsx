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
  { key: "showGridChange", label: "Grid position change" },
  { key: "showGapToLeader", label: "Gap to leader" },
  { key: "showPitStops", label: "Pit stops" },
  { key: "showTyreType", label: "Tyre type" },
  { key: "showTyreAge", label: "Tyre age" },
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close settings on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [settingsOpen]);

  return (
    <>
      <div className="bg-f1-card border-b border-f1-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="flex-shrink-0">
            <img src="/logo.png" alt="Home" className="w-10 h-10 rounded-lg hover:opacity-80 transition-opacity" />
          </a>
          <div>
            <h1 className="text-sm font-extrabold text-white">
              {year} {eventName}
            </h1>
            <p className="text-xs font-bold text-f1-muted">
              {circuit}, {country}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-f1-red px-4 py-1 rounded text-white font-extrabold text-xs uppercase">
            {SESSION_LABELS[sessionType] || sessionType}
          </div>

          {/* Info button */}
          <button
            onClick={() => setInfoOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
            </svg>
          </button>

          {/* Settings */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {settingsOpen && (
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

      {/* Info modal */}
      {infoOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInfoOpen(false);
          }}
        >
          <div className="bg-f1-card border border-f1-border rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-f1-border">
              <h2 className="text-lg font-bold text-white">How it works</h2>
              <button
                onClick={() => setInfoOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-6">
              {/* Positions & Timing */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Driver positions &amp; timing
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Driver positions and gap times are sourced directly from the official
                  F1 live timing feed — the same data used by the broadcast. Positions
                  are determined by sorting drivers on their gap to the leader, which
                  updates multiple times per lap at sector and mini-sector boundaries.
                </p>
                <p className="text-sm text-f1-muted leading-relaxed mt-2">
                  For the first few seconds of the race, the starting grid order is
                  shown before timing data becomes available.
                </p>
              </div>

              {/* Data availability */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Data availability
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Occasionally, timing data may be temporarily unavailable for a
                  driver — for example, during pit stops or if the F1 timing system
                  has a brief gap. When this happens, the affected driver is shown
                  greyed out at the bottom of the leaderboard. They return to their
                  correct position as soon as data is available again.
                </p>
              </div>

              {/* Track map */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Track map
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Car positions on the track are derived from GPS telemetry data
                  and update every 0.5 seconds. Movement is smoothed for a cleaner
                  visual. The track orientation matches the conventional broadcast
                  view for each circuit.
                </p>
              </div>

              {/* Session time */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Session time
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Total session time is hidden by default to avoid spoilers — a
                  shorter-than-expected session can reveal red flags or early
                  finishes. You can enable it in the settings menu.
                </p>
              </div>

              {/* Data source */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Data source
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  All data is sourced from the official F1 timing feed via
                  the FastF1 library. Session data typically becomes available
                  1–2 hours after the chequered flag.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
