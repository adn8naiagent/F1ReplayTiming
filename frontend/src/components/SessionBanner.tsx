"use client";

import { useState, useRef, useEffect } from "react";
import { ReplaySettings, DEFAULTS as DEFAULT_SETTINGS } from "@/hooks/useSettings";
import { WeatherData } from "@/hooks/useReplaySocket";

interface Props {
  eventName: string;
  circuit: string;
  country: string;
  sessionType: string;
  year: number;
  settings?: ReplaySettings;
  onSettingChange?: (key: keyof ReplaySettings, value: boolean) => void;
  weather?: WeatherData;
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

const LEADERBOARD_SETTINGS: { key: keyof ReplaySettings; label: string; raceOnly?: boolean; badge?: string }[] = [
  { key: "showTeamAbbr", label: "Team" },
  { key: "showGridChange", label: "Grid position change", raceOnly: true },
  { key: "showGapToLeader", label: "Gap" },
  { key: "showPitStops", label: "Pit stops", raceOnly: true },
  { key: "showTyreType", label: "Tyre type" },
  { key: "showTyreAge", label: "Tyre age" },
  { key: "showTyreHistory", label: "Tyre history", raceOnly: true },
  { key: "showPitPrediction", label: "Pit prediction", raceOnly: true, badge: "Beta" },
];

const WEATHER_SETTINGS: { key: keyof ReplaySettings; label: string }[] = [
  { key: "showAirTemp", label: "Air temperature" },
  { key: "showTrackTemp", label: "Track temperature" },
  { key: "showHumidity", label: "Humidity" },
  { key: "showWind", label: "Wind" },
  { key: "showRainfall", label: "Rainfall" },
];

const OTHER_SETTINGS: { key: keyof ReplaySettings; label: string }[] = [
  { key: "showDriverNames", label: "Driver names on track" },
  { key: "showSessionTime", label: "Total session time" },
];

export default function SessionBanner({
  eventName,
  circuit,
  country,
  sessionType,
  year,
  settings: settingsProp,
  onSettingChange,
  weather,
}: Props) {
  const settings = settingsProp || DEFAULT_SETTINGS;
  const isRace = sessionType === "R" || sessionType === "S";
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

  const weatherBar = weather && settings.showWeather ? (
    <div className="flex items-center gap-3 text-xs text-f1-muted flex-wrap">
      {settings.showAirTemp && (
        <span className="flex items-center gap-1" title="Air temperature">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="m15.98 11.52c-.33-.28-.51-.74-.51-1.26v-4.62c0-1.86-1.38-3.45-3.14-3.63-.98-.1-1.97.22-2.71.89-.73.66-1.15 1.61-1.15 2.6v4.79c0 .53-.19 1-.51 1.3-1.58 1.43-2.27 3.55-1.84 5.66.46 2.31 2.31 4.18 4.61 4.66.43.09.86.13 1.28.13 1.38 0 2.72-.46 3.8-1.34 1.42-1.15 2.23-2.86 2.23-4.68 0-1.72-.75-3.36-2.06-4.51zm-1.43 7.63c-.96.78-2.17 1.07-3.42.81-1.52-.32-2.75-1.56-3.06-3.1-.28-1.41.18-2.83 1.23-3.79.74-.67 1.17-1.69 1.17-2.78v-4.79c0-.43.18-.83.49-1.11.28-.25.63-.39 1.01-.39h.16c.75.08 1.34.79 1.34 1.64v4.62c0 1.09.44 2.1 1.2 2.77.87.76 1.37 1.86 1.37 3 0 1.22-.54 2.36-1.49 3.13z"/>
            <circle cx="12" cy="16" r="2.47"/>
          </svg>
          {weather.air_temp}°C
        </span>
      )}
      {settings.showTrackTemp && (
        <span className="flex items-center gap-1" title="Track temperature">
          <svg className="w-3.5 h-3.5" viewBox="0 0 512 512" fill="currentColor">
            <path d="M162.9.4c-5.7-1.6-11.6 1.7-13.2 7.4L11.1 498.4c-1.6 5.7 1.7 11.6 7.4 13.2c.9.3 1.9.4 2.9.4c4.8 0 9-3.2 10.3-7.8L170.3 13.6c1.6-5.7-1.7-11.6-7.4-13.2z"/>
            <path d="M500.9 498.4L362.3 7.8c-1.6-5.7-7.5-9-13.2-7.4-5.7 1.6-9 7.5-7.4 13.2l138.7 490.7c1.3 4.6 5.5 7.8 10.3 7.8 1 0 2-.1 2.9-.4 5.7-1.6 9-7.5 7.4-13.2z"/>
            <path d="M256 405.3c-5.9 0-10.7 4.8-10.7 10.7v85.3c0 5.9 4.8 10.7 10.7 10.7s10.7-4.8 10.7-10.7V416c0-5.9-4.8-10.7-10.7-10.7z"/>
            <path d="M256 234.7c-5.9 0-10.7 4.8-10.7 10.7v85.3c0 5.9 4.8 10.7 10.7 10.7s10.7-4.8 10.7-10.7v-85.3c0-5.9-4.8-10.7-10.7-10.7z"/>
            <path d="M256 85.3c-5.9 0-10.7 4.8-10.7 10.7v64c0 5.9 4.8 10.7 10.7 10.7s10.7-4.8 10.7-10.7v-64c0-5.9-4.8-10.7-10.7-10.7z"/>
            <path d="M256 0c-5.9 0-10.7 4.8-10.7 10.7V32c0 5.9 4.8 10.7 10.7 10.7s10.7-4.8 10.7-10.7V10.7C266.7 4.8 261.9 0 256 0z"/>
          </svg>
          {weather.track_temp}°C
        </span>
      )}
      {settings.showHumidity && (
        <span className="flex items-center gap-1" title="Humidity">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3C12 3 5 11 5 15a7 7 0 0014 0c0-4-7-12-7-12z" />
          </svg>
          {weather.humidity}%
        </span>
      )}
      {settings.showRainfall && (
        <span className={`flex items-center gap-1 ${weather.rainfall ? "text-blue-400" : ""}`} title="Rainfall">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-4.584-7A6 6 0 003 15z" />
          </svg>
          {weather.rainfall ? "Rain" : "Dry"}
        </span>
      )}
      {settings.showWind && (
        <span className="flex items-center gap-1" title={`Wind direction: ${weather.wind_direction}°`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            style={{ transform: `rotate(${weather.wind_direction}deg)` }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-4 4m4-4l4 4" />
          </svg>
          {weather.wind_speed} m/s
        </span>
      )}
    </div>
  ) : null;

  return (
    <>
      <div className="bg-f1-card border-b border-f1-border px-3 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <a href="/" className="flex-shrink-0">
            <img src="/logo.png" alt="Home" className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg hover:opacity-80 transition-opacity" />
          </a>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-extrabold text-white truncate">
              {year} {eventName}
            </h1>
            <p className="text-[10px] sm:text-xs font-bold text-f1-muted truncate">
              {circuit}, {country}
            </p>
          </div>
        </div>

        {/* Weather - desktop only (inline in header) */}
        {weatherBar && (
          <div className="hidden sm:flex items-center gap-3 ml-auto mr-48">
            {weatherBar}
          </div>
        )}

        <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
          <div className="bg-f1-red px-2 sm:px-4 py-1 rounded text-white font-extrabold text-[10px] sm:text-xs uppercase">
            {SESSION_LABELS[sessionType] || sessionType}
          </div>

          {/* Features link - hidden on mobile */}
          <a
            href="/features"
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
            title="Features"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </a>

          {/* Info button - hidden on mobile */}
          <button
            onClick={() => setInfoOpen(true)}
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
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
              className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {settingsOpen && (
              <div className="fixed right-2 top-[52px] mt-2 w-72 bg-[#1A1A26] border border-f1-border rounded-lg shadow-xl z-50 py-2">
                {/* Driver Leaderboard section */}
                <button
                  onClick={() => onSettingChange?.("showLeaderboard", !settings.showLeaderboard)}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Driver Leaderboard</span>
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      settings.showLeaderboard ? "bg-f1-red" : "bg-f1-border"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.showLeaderboard ? "translate-x-[18px]" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </button>
                {LEADERBOARD_SETTINGS.filter(s => !s.raceOnly || isRace).map(({ key, label, badge }) => (
                  <button
                    key={key}
                    onClick={() => onSettingChange?.(key, !settings[key])}
                    disabled={!settings.showLeaderboard}
                    className={`w-full flex items-center justify-between pl-8 pr-4 py-1.5 hover:bg-white/5 transition-colors ${
                      !settings.showLeaderboard ? "opacity-40 pointer-events-none" : ""
                    }`}
                  >
                    <span className="text-sm text-white flex items-center gap-2">
                      {label}
                      {badge && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-f1-red/20 text-f1-red leading-none">
                          {badge}
                        </span>
                      )}
                    </span>
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

                {/* Divider */}
                <div className="border-t border-f1-border my-2" />

                {/* Weather section */}
                <button
                  onClick={() => onSettingChange?.("showWeather", !settings.showWeather)}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Weather</span>
                  <div
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      settings.showWeather ? "bg-f1-red" : "bg-f1-border"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.showWeather ? "translate-x-[18px]" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </button>
                {WEATHER_SETTINGS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => onSettingChange?.(key, !settings[key])}
                    disabled={!settings.showWeather}
                    className={`w-full flex items-center justify-between pl-8 pr-4 py-1.5 hover:bg-white/5 transition-colors ${
                      !settings.showWeather ? "opacity-40 pointer-events-none" : ""
                    }`}
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

                {/* Divider */}
                <div className="border-t border-f1-border my-2" />

                {/* Other settings */}
                <div className="px-4 py-2">
                  <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Other</span>
                </div>
                {OTHER_SETTINGS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => onSettingChange?.(key, !settings[key])}
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

      {/* Weather bar - mobile only (separate row below header) */}
      {weatherBar && (
        <div className="sm:hidden bg-f1-card border-b border-f1-border px-3 py-1.5">
          {weatherBar}
        </div>
      )}

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
                  F1 live timing feed  - the same data used by the broadcast. Positions
                  are determined by sorting drivers on their gap to the leader, which
                  updates multiple times per lap at sector and mini-sector boundaries.
                </p>
                <p className="text-sm text-f1-muted leading-relaxed mt-2">
                  For the first few seconds of the race, the starting grid order is
                  shown before timing data becomes available. Grid position changes
                  are only displayed after 10 seconds to ensure accuracy.
                </p>
              </div>

              {/* Data availability */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Data availability
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Occasionally, timing data may be temporarily unavailable for a
                  driver  - for example, during pit stops or if the F1 timing system
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

              {/* Tyre history */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Tyre history
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  The leaderboard shows the last two tyre compounds used by each
                  driver as smaller icons next to their current tyre. Tyre changes
                  and pit stop counts update when the driver exits the pit lane.
                </p>
              </div>

              {/* Session time */}
              <div>
                <h3 className="text-sm font-bold text-f1-red uppercase tracking-wider mb-2">
                  Session time
                </h3>
                <p className="text-sm text-f1-muted leading-relaxed">
                  Total session time is hidden by default to avoid spoilers. A
                  longer-than-expected session can reveal red flags and
                  stoppages. You can enable it in the settings menu.
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
