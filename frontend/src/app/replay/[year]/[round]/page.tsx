"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useReplaySocket } from "@/hooks/useReplaySocket";
import { useSettings } from "@/hooks/useSettings";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import Leaderboard from "@/components/Leaderboard";
import PlaybackControls from "@/components/PlaybackControls";
import TelemetryChart from "@/components/TelemetryChart";
import SyncPhoto from "@/components/SyncPhoto";

interface TrackData {
  track_points: { x: number; y: number }[];
  rotation: number;
  circuit_name: string;
}

interface SessionData {
  year: number;
  round_number: number;
  event_name: string;
  circuit: string;
  country: string;
  session_type: string;
  drivers: Array<{
    abbreviation: string;
    driver_number: string;
    full_name: string;
    team_name: string;
    team_color: string;
  }>;
}

export default function ReplayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const year = Number(params.year);
  const round = Number(params.round);
  const sessionType = searchParams.get("type") || "R";

  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showSyncPhoto, setShowSyncPhoto] = useState(false);

  function handleDriverClick(abbr: string) {
    setSelectedDrivers((prev) => {
      if (prev.includes(abbr)) {
        return prev.filter((d) => d !== abbr);
      }
      if (prev.length >= 2) {
        // Replace the oldest selection
        return [prev[1], abbr];
      }
      return [...prev, abbr];
    });
  }
  const { settings, update: updateSetting } = useSettings();

  const { data: sessionData, loading: sessionLoading, error: sessionError } = useApi<SessionData>(
    `/api/sessions/${year}/${round}?type=${sessionType}`,
  );

  const { data: trackData, loading: trackLoading, error: trackError } = useApi<TrackData>(
    `/api/sessions/${year}/${round}/track?type=${sessionType}`,
  );

  const replay = useReplaySocket(year, round, sessionType);

  const isLoading = sessionLoading || trackLoading;
  const dataError = sessionError || trackError;

  // Show loading until session + track + replay frames are all ready
  if (isLoading || (!dataError && replay.loading)) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin mb-6" />
          <p className="text-f1-muted text-lg">Loading session data...</p>
          <p className="text-f1-muted text-sm mt-2">
            First load may take up to 60 seconds while data is fetched
          </p>
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-bold mb-2">Session Unavailable</p>
          <p className="text-f1-muted mb-1">
            Data for this session is not available yet.
          </p>
          <p className="text-f1-muted text-sm mb-6">
            If the session just finished, data typically becomes available 1–2 hours after the chequered flag.
          </p>
          <a href="/" className="inline-block px-4 py-2 bg-f1-red text-white font-bold text-sm rounded hover:bg-red-700 transition-colors">
            Back to session picker
          </a>
        </div>
      </div>
    );
  }

  const trackPoints = trackData?.track_points || [];
  const rotation = trackData?.rotation || 0;
  const drivers = replay.frame?.drivers || [];
  const trackStatus = replay.frame?.status || "green";
  const weather = replay.frame?.weather;
  const isRace = sessionType === "R" || sessionType === "S";

  // Calculate leaderboard width based on active columns
  const leaderboardWidth = (() => {
    let w = 106; // base: position(24) + team bar(12) + driver(30) + flags(16) + padding(16) + right padding(8)
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18; // pit indicator (P box + margin)
    if (isRace && settings.showGridChange) w += 24;
    if (settings.showGapToLeader) w += 56;
    if (isRace && settings.showPitStops) w += 24;
    if (isRace && settings.showTyreHistory) w += 36;
    if (settings.showTyreType) w += 24;
    if (settings.showTyreAge) w += 20;
    return w;
  })();

  return (
    <div className="h-screen flex flex-col bg-f1-dark overflow-hidden">
      {/* Banner */}
      {sessionData && (
        <SessionBanner
          eventName={sessionData.event_name}
          circuit={sessionData.circuit}
          country={sessionData.country}
          sessionType={sessionType}
          year={year}
          settings={settings}
          onSettingChange={updateSetting}
          weather={weather}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Track */}
        <div className="flex-1 relative">
          {/* Flag badge */}
          {trackStatus !== "green" && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div
                className={`px-3 py-1 rounded text-xs font-extrabold uppercase ${
                  trackStatus === "red"
                    ? "bg-red-600 text-white"
                    : trackStatus === "sc"
                    ? "bg-yellow-500 text-black"
                    : trackStatus === "vsc"
                    ? "bg-yellow-500/80 text-black"
                    : "bg-yellow-400 text-black"
                }`}
              >
                {trackStatus === "red"
                  ? "Red Flag"
                  : trackStatus === "sc"
                  ? "Safety Car"
                  : trackStatus === "vsc"
                  ? "Virtual Safety Car"
                  : "Yellow Flag"}
              </div>
            </div>
          )}

          <TrackCanvas
            trackPoints={trackPoints}
            rotation={rotation}
            trackStatus={trackStatus}
            drivers={drivers.filter((d) => !d.retired).map((d) => ({
              abbr: d.abbr,
              x: d.x,
              y: d.y,
              color: d.color,
              position: d.position,
            }))}
            highlightedDrivers={selectedDrivers}
            playbackSpeed={replay.speed}
            showDriverNames={settings.showDriverNames}
          />

          {/* Telemetry overlay */}
          {showTelemetry && (
            <div className="absolute bottom-2 left-8 z-10">
              {selectedDrivers.map((abbr) => {
                const drv = drivers.find((d) => d.abbr === abbr) || null;
                return <TelemetryChart key={abbr} visible driver={drv} year={year} />;
              })}
              {selectedDrivers.length === 0 && (
                <TelemetryChart visible driver={null} year={year} />
              )}
            </div>
          )}

          {/* Telemetry toggle */}
          <button
            onClick={() => setShowTelemetry(!showTelemetry)}
            className="absolute bottom-2 right-2 px-2 py-1 bg-f1-card/80 border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-white transition-colors"
          >
            {showTelemetry ? "Hide" : "Show"} Telemetry
          </button>
        </div>

        {/* Leaderboard sidebar */}
        {settings.showLeaderboard && (
          <div className="flex-shrink-0" style={{ width: leaderboardWidth }}>
            <Leaderboard
              drivers={drivers}
              highlightedDrivers={selectedDrivers}
              onDriverClick={handleDriverClick}
              settings={settings}
              currentTime={replay.frame?.timestamp || 0}
              isRace={isRace}
            />
          </div>
        )}
      </div>

      {/* Playback controls */}
      <PlaybackControls
        playing={replay.playing}
        speed={replay.speed}
        currentTime={replay.frame?.timestamp || 0}
        totalTime={replay.totalTime}
        currentLap={replay.frame?.lap || 0}
        totalLaps={replay.totalLaps}
        finished={replay.finished}
        showSessionTime={settings.showSessionTime}
        onPlay={replay.play}
        onPause={replay.pause}
        onSpeedChange={replay.setSpeed}
        onSeek={replay.seek}
        onSeekToLap={replay.seekToLap}
        onReset={replay.reset}
        isRace={isRace}
        onSyncPhoto={() => setShowSyncPhoto(true)}
        qualiPhase={replay.frame?.quali_phase}
        qualiPhases={replay.qualiPhases}
      />

      {/* Sync with photo modal */}
      {showSyncPhoto && (
        <SyncPhoto
          year={year}
          round={round}
          sessionType={sessionType}
          onSync={(timestamp) => replay.seek(timestamp)}
          onClose={() => setShowSyncPhoto(false)}
        />
      )}
    </div>
  );
}
