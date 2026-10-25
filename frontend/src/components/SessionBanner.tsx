"use client";

import { useState, useRef, useEffect } from "react";
import { ReplaySettings, DEFAULTS as DEFAULT_SETTINGS } from "@/hooks/useSettings";
import { WeatherData } from "@/hooks/useReplaySocket";
import { useAppConfig } from "@/lib/config";
import F1TVAccount from "./F1TVAccount";
import CaptionSettings from "./CaptionSettings";

interface Props {
  eventName: string;
  circuit: string;
  country: string;
  sessionType: string;
  year: number;
  settings?: ReplaySettings;
  onSettingChange?: (key: keyof ReplaySettings, value: boolean) => void;
  weather?: WeatherData;
  extraActions?: React.ReactNode;
  mobileTeamAbbrHidden?: boolean;
  onReportProblem?: () => void;
  /** Show Settings > Broadcast (F1 TV Pro or Premium) */
  broadcastSettings?: boolean;
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

const LEADERBOARD_SETTINGS: { key: keyof ReplaySettings; label: string; raceOnly?: boolean; nonRaceOnly?: boolean; qualiOnly?: boolean; badge?: string; parent?: keyof ReplaySettings }[] = [
  { key: "showTeamAbbr", label: "Team" },
  { key: "showGridChange", label: "Grid position change", raceOnly: true },
  { key: "showBestLapTime", label: "Best time", nonRaceOnly: true },
  { key: "showLastLapTime", label: "Last lap time" },
  { key: "showGapToLeader", label: "Gap" },
  { key: "highlightClose", label: "Highlight under 1s", raceOnly: true },
  { key: "showPitStops", label: "Pit stops", raceOnly: true },
  { key: "showTyreType", label: "Tyre type" },
  { key: "showTyreAge", label: "Tyre age" },
  { key: "showTyreHistory", label: "Tyre history", raceOnly: true },
  { key: "showSectors", label: "Live sectors", nonRaceOnly: true },
  { key: "showMiniSectors", label: "Mini-sectors", nonRaceOnly: true, parent: "showSectors" },
  { key: "showLapNotifications", label: "Lap notifications", qualiOnly: true },
  { key: "showLapNotificationSectors", label: "Sector times", qualiOnly: true, parent: "showLapNotifications" },
  { key: "showPitPrediction", label: "Pit prediction", raceOnly: true },
  { key: "showPitConfidence", label: "Confidence", raceOnly: true, parent: "showPitPrediction" },
  { key: "showPitFreeAir", label: "Pit gaps", raceOnly: true, parent: "showPitPrediction" },
];

const WEATHER_SETTINGS: { key: keyof ReplaySettings; label: string }[] = [
  { key: "showAirTemp", label: "Air temperature" },
  { key: "showTrackTemp", label: "Track temperature" },
  { key: "showHumidity", label: "Humidity" },
  { key: "showWind", label: "Wind" },
  { key: "showRainfall", label: "Rainfall" },
];

const TRACK_MAP_SETTINGS: { key: keyof ReplaySettings; label: string }[] = [
  { key: "showDriverNames", label: "Driver names on track" },
  { key: "showCorners", label: "Corner numbers" },
  { key: "showElevation", label: "Elevation" },
];

const OTHER_SETTINGS: { key: keyof ReplaySettings; label: string; hint?: string }[] = [
  { key: "showAllPanels", label: "Open all data panels" },
  { key: "showSessionTime", label: "Show total session time", hint: "May indicate red flags and spoilers" },
  { key: "useImperial", label: "Imperial units (°F, mph)" },
  { key: "highContrast", label: "High contrast text" },
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
  extraActions,
  mobileTeamAbbrHidden,
  onReportProblem,
  broadcastSettings,
}: Props) {
  const settings = settingsProp || DEFAULT_SETTINGS;
  const isRace = sessionType === "R" || sessionType === "S";
  const isQualifying = sessionType === "Q" || sessionType === "SQ";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"Leaderboard" | "Weather" | "Track Map" | "Race Control" | "Team Radio" | "Broadcast" | "Other" | "F1 TV" | "Report a bug">("Leaderboard");
  const appConfig = useAppConfig();
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
          {settings.useImperial ? `${Math.round(weather.air_temp * 9 / 5 + 32)}°F` : `${weather.air_temp}°C`}
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
          {settings.useImperial ? `${Math.round(weather.track_temp * 9 / 5 + 32)}°F` : `${weather.track_temp}°C`}
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
          {settings.useImperial ? `${Math.round(weather.wind_speed * 2.237)} mph` : `${weather.wind_speed} m/s`}
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
          {extraActions}
          <div className="bg-f1-red px-2 sm:px-4 py-1 rounded text-white font-extrabold text-[10px] sm:text-xs uppercase">
            {SESSION_LABELS[sessionType] || sessionType}
          </div>

          {/* Features/info link */}
          <a
            href="/features"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-8 h-8 sm:w-9 sm:h-9 items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
            title="How it works"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
            </svg>
          </a>

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

            {settingsOpen && (<>
              {/* Modal backdrop */}
              <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSettingsOpen(false)} />

              {/* Settings modal */}
              <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 h-[450px] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 sm:w-[520px] sm:h-[450px] bg-[#1A1A26] border border-f1-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Modal header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-f1-border">
                  <span className="text-sm font-bold text-white">Settings</span>
                  <button onClick={() => setSettingsOpen(false)} className="text-f1-muted hover:text-white">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Tabs + content side by side */}
                <div className="flex flex-1 min-h-0">
                  {/* Tab sidebar */}
                  <div className="flex flex-col border-r border-f1-border py-2 w-36 flex-shrink-0">
                    {([
                      "Leaderboard", "Weather", "Track Map", "Race Control", "Team Radio",
                      ...(broadcastSettings ? (["Broadcast"] as const) : []),
                      "Other",
                      ...(appConfig?.f1tv ? (["F1 TV"] as const) : []),
                      ...(onReportProblem ? (["Report a bug"] as const) : []),
                    ] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSettingsTab(tab)}
                        className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-left transition-colors ${
                          settingsTab === tab
                            ? "text-white bg-white/5 border-l-2 border-f1-red"
                            : "text-f1-muted hover:text-white border-l-2 border-transparent"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div className="pt-4 pb-2 flex-1 overflow-y-auto px-1 sm:px-4">
                  {settingsTab === "Leaderboard" && (<>
                    <button
                      onClick={() => onSettingChange?.("showLeaderboard", !settings.showLeaderboard)}
                      className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Show Leaderboard</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.showLeaderboard ? "bg-f1-red" : "bg-f1-border"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings.showLeaderboard ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </div>
                    </button>
                    {LEADERBOARD_SETTINGS.filter(s => (!s.raceOnly || isRace) && (!s.nonRaceOnly || !isRace) && (!s.qualiOnly || isQualifying)).map(({ key, label, badge, parent }) => {
                      const parentOff = parent ? !settings[parent] : false;
                      const disabled = !settings.showLeaderboard || parentOff;
                      return (
                        <button
                          key={key}
                          onClick={() => onSettingChange?.(key, !settings[key])}
                          disabled={disabled}
                          className={`w-full flex items-center justify-between ${parent ? "pl-6 sm:pl-12" : "pl-4 sm:pl-10"} pr-2 sm:pr-6 py-1 hover:bg-white/5 transition-colors ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                        >
                          <span className={`${parent ? "text-xs text-f1-muted" : "text-sm text-white"} flex items-center gap-2`}>
                            {label}
                            {badge && <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-f1-red/20 text-f1-red leading-none">{badge}</span>}
                            {key === "showTeamAbbr" && mobileTeamAbbrHidden && (
                              <span className="px-1 py-0.5 text-[7px] font-bold uppercase rounded bg-yellow-500/20 text-yellow-500 leading-none">Auto-hidden</span>
                            )}
                          </span>
                          <div className={`relative ${parent ? "w-7 h-4" : "w-9 h-5"} rounded-full transition-colors ${settings[key] ? "bg-f1-red" : "bg-f1-border"}`}>
                            <div className={`absolute top-0.5 ${parent ? "w-3 h-3" : "w-4 h-4"} bg-white rounded-full transition-transform ${settings[key] ? (parent ? "translate-x-[14px]" : "translate-x-[18px]") : "translate-x-0.5"}`} />
                          </div>
                        </button>
                      );
                    })}
                  </>)}

                  {settingsTab === "Weather" && (<>
                    <button
                      onClick={() => onSettingChange?.("showWeather", !settings.showWeather)}
                      className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Show Weather</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.showWeather ? "bg-f1-red" : "bg-f1-border"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings.showWeather ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </div>
                    </button>
                    {WEATHER_SETTINGS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => onSettingChange?.(key, !settings[key])}
                        disabled={!settings.showWeather}
                        className={`w-full flex items-center justify-between pl-4 sm:pl-10 pr-2 sm:pr-6 py-1 hover:bg-white/5 transition-colors ${!settings.showWeather ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        <span className="text-sm text-white">{label}</span>
                        <div className={`relative w-9 h-5 rounded-full transition-colors ${settings[key] ? "bg-f1-red" : "bg-f1-border"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings[key] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    ))}
                  </>)}

                  {settingsTab === "Track Map" && (<>
                    {TRACK_MAP_SETTINGS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => onSettingChange?.(key, !settings[key])}
                        className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                      >
                        <span className="text-sm text-white">{label}</span>
                        <div className={`relative w-9 h-5 rounded-full transition-colors ${settings[key] ? "bg-f1-red" : "bg-f1-border"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings[key] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    ))}
                  </>)}

                  {settingsTab === "Race Control" && (<>
                    <button
                      onClick={() => onSettingChange?.("rcSound", !settings.rcSound)}
                      className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      <span className="text-sm text-white">Notification sound</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.rcSound ? "bg-f1-red" : "bg-f1-border"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings.rcSound ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </div>
                    </button>
                  </>)}

                  {settingsTab === "Team Radio" && (<>
                    <button
                      onClick={() => onSettingChange?.("showTeamRadio", !settings.showTeamRadio)}
                      className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      <span className="text-xs font-bold text-f1-muted uppercase tracking-wider">Show Team Radio</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.showTeamRadio ? "bg-f1-red" : "bg-f1-border"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings.showTeamRadio ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </div>
                    </button>
                    <button
                      onClick={() => onSettingChange?.("teamRadioMuted", !settings.teamRadioMuted)}
                      disabled={!settings.showTeamRadio}
                      className={`w-full flex items-center justify-between pl-4 sm:pl-10 pr-2 sm:pr-6 py-1 hover:bg-white/5 transition-colors ${!settings.showTeamRadio ? "opacity-40 pointer-events-none" : ""}`}
                    >
                      <span className="text-sm text-white">Mute audio</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.teamRadioMuted ? "bg-f1-red" : "bg-f1-border"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings.teamRadioMuted ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </div>
                    </button>
                    <p className="px-2 sm:px-6 pt-3 text-xs text-f1-muted leading-relaxed">
                      The radio messages F1 picks for the broadcast, shown over the track map with a caption. In replays, audio plays at 1x speed only.
                    </p>
                    <p className="px-2 sm:px-6 pt-2 text-xs text-f1-muted leading-relaxed">
                      {appConfig?.f1tv
                        ? "Captions are made locally using Whisper, and can be improved by an AI model (below). Accuracy varies depending on quality and clarity."
                        : "Captions are made locally using Whisper. Accuracy varies depending on quality and clarity."}
                    </p>
                    {appConfig?.f1tv && <CaptionSettings />}
                  </>)}

                  {settingsTab === "Broadcast" && broadcastSettings && (<>
                    <div className="px-2 sm:px-6 pb-2">
                      <span className="block text-sm text-white mb-1.5">View</span>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          [true, "Multi-view", "The broadcast, up to two onboards and the track map side by side"],
                          [false, "Broadcast", "The broadcast full width, with the track map over it"],
                        ] as const).map(([value, label, hint]) => (
                          <button
                            key={label}
                            onClick={() => onSettingChange?.("broadcastMultiView", value)}
                            className={`text-left rounded border px-3 py-2 transition-colors ${
                              settings.broadcastMultiView === value
                                ? "border-f1-red bg-f1-red/10"
                                : "border-f1-border hover:border-f1-muted"
                            }`}
                          >
                            <span className="block text-xs font-bold text-white">{label}</span>
                            <span className="block text-[10px] text-f1-muted mt-0.5 leading-snug">{hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {([
                      ["broadcastTelemetry", "Onboard telemetry", "Speed, gear, throttle and brake along the bottom of each onboard"],
                      ["broadcastMap", "Track map", "Beside the onboards, or over the broadcast"],
                    ] as const).map(([key, label, hint]) => (
                      <button
                        key={key}
                        onClick={() => onSettingChange?.(key, !settings[key])}
                        className="w-full flex items-center justify-between gap-3 px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors text-left"
                      >
                        <span>
                          <span className="block text-sm text-white">{label}</span>
                          <span className="block text-[10px] text-f1-muted">{hint}</span>
                        </span>
                        <div className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors ${settings[key] ? "bg-f1-red" : "bg-f1-border"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings[key] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    ))}
                    <p className="px-2 sm:px-6 pt-3 text-xs text-f1-muted leading-relaxed">
                      The hover controls on the broadcast switch the view and track map for now, without changing these.
                    </p>
                  </>)}

                  {settingsTab === "Other" && (<>
                    {OTHER_SETTINGS.map(({ key, label, hint }) => (
                      <button
                        key={key}
                        onClick={() => onSettingChange?.(key, !settings[key])}
                        className="w-full flex items-center justify-between px-2 sm:px-6 py-1.5 hover:bg-white/5 transition-colors"
                      >
                        <span className="text-left">
                          <span className="text-sm text-white block">{label}</span>
                          {hint && <span className="text-[9px] text-f1-muted block">{hint}</span>}
                        </span>
                        <div className={`relative w-9 h-5 rounded-full transition-colors ${settings[key] ? "bg-f1-red" : "bg-f1-border"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${settings[key] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    ))}
                  </>)}

                  {settingsTab === "F1 TV" && appConfig?.f1tv && <F1TVAccount />}
                  {settingsTab === "Report a bug" && onReportProblem && (
                    <div className="px-2 sm:px-6 py-2 space-y-3">
                      <p className="text-sm text-f1-muted leading-relaxed">
                        Something not working? This opens a GitHub issue with this session and the current
                        replay time already filled in.
                      </p>
                      <button
                        onClick={onReportProblem}
                        className="px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors"
                      >
                        Report a bug
                      </button>
                    </div>
                  )}
                </div>
                </div>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {/* Weather bar - mobile only (separate row below header) */}
      {weatherBar && (
        <div className="sm:hidden bg-f1-card border-b border-f1-border px-3 py-1.5">
          {weatherBar}
        </div>
      )}

    </>
  );
}
