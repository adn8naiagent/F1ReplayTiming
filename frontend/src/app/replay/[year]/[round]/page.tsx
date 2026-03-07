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

  const [highlightedDriver, setHighlightedDriver] = useState<string | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);
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
            highlightedDriver={highlightedDriver}
          />

          {/* Telemetry toggle */}
          <button
            onClick={() => setShowTelemetry(!showTelemetry)}
            className="absolute bottom-4 right-4 px-3 py-1.5 bg-f1-card border border-f1-border rounded text-xs text-f1-muted hover:text-white transition-colors"
          >
            {showTelemetry ? "Hide" : "Show"} Telemetry
          </button>
        </div>

        {/* Leaderboard sidebar */}
        <div className="w-72 flex-shrink-0">
          <Leaderboard
            drivers={drivers}
            highlightedDriver={highlightedDriver}
            onDriverClick={(abbr) =>
              setHighlightedDriver(highlightedDriver === abbr ? null : abbr)
            }
            settings={settings}
          />
        </div>
      </div>

      {/* Telemetry panel */}
      <TelemetryChart visible={showTelemetry} />

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
      />
    </div>
  );
}
