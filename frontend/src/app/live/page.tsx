"use client";

import { useState, useEffect } from "react";
import { useLiveTiming } from "@/hooks/useLiveTiming";
import { useApi } from "@/hooks/useApi";
import { useSettings } from "@/hooks/useSettings";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import Leaderboard from "@/components/Leaderboard";

interface LiveStatus {
  live: boolean;
  active: boolean;
  session: {
    session_key: number;
    session_name: string;
    session_type: string;
    circuit: string;
    country: string;
    event_name: string;
    date_start: string;
    date_end: string | null;
    year: number;
  } | null;
}

export default function LivePage() {
  const { data: status, loading } = useApi<LiveStatus>("/api/live/status");
  const { connected, sessionInfo, frame, trackPoints, error } = useLiveTiming();
  const { settings, update: updateSetting } = useSettings();
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTrackOpen, setMobileTrackOpen] = useState(true);
  const [mobileLeaderboardOpen, setMobileLeaderboardOpen] = useState(true);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  function handleDriverClick(abbr: string) {
    setSelectedDrivers((prev) => {
      if (prev.includes(abbr)) return prev.filter((d) => d !== abbr);
      if (prev.length >= 2) return [prev[1], abbr];
      return [...prev, abbr];
    });
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin mb-6" />
          <p className="text-f1-muted text-lg">Checking for live session...</p>
        </div>
      </div>
    );
  }

  // No live session
  if (!status?.live || !status.session) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-f1-card border border-f1-border flex items-center justify-center">
            <svg className="w-10 h-10 text-f1-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Live Session</h2>
          <p className="text-f1-muted mb-2">
            There is no Formula 1 session happening right now. Live data becomes available during practice, qualifying, and race sessions.
          </p>
          <p className="text-f1-muted text-sm mb-6">
            Data is provided by OpenF1 with a small delay (~30s).
          </p>
          <div className="flex gap-3 justify-center">
            <a
              href="/"
              className="px-4 py-2 bg-f1-red text-white font-bold text-sm rounded hover:bg-red-700 transition-colors"
            >
              Browse Replays
            </a>
          </div>
        </div>
      </div>
    );
  }

  const drivers = frame?.drivers || [];
  const trackStatus = frame?.status || "green";
  const weather = frame?.weather;
  const sessionType = status.session.session_type === "Qualifying" ? "Q" : status.session.session_type === "Sprint" ? "S" : "R";
  const isRace = sessionType === "R";

  const leaderboardWidth = (() => {
    let w = 106;
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18;
    if (isRace && settings.showGridChange) w += 24;
    if (settings.showGapToLeader) w += 56;
    if (isRace && settings.showPitStops) w += 24;
    if (isRace && settings.showTyreHistory) w += 36;
    if (settings.showTyreType) w += 24;
    if (settings.showTyreAge) w += 20;
    if (isRace && settings.showPitPrediction) w += 40;
    return w;
  })();

  return (
    <div className="h-screen flex flex-col bg-f1-dark overflow-hidden">
      {/* Banner */}
      <SessionBanner
        eventName={sessionInfo?.event_name || status.session.event_name}
        circuit={sessionInfo?.circuit || status.session.circuit}
        country={sessionInfo?.country || status.session.country}
        sessionType={sessionType}
        year={status.session.year}
        settings={settings}
        onSettingChange={updateSetting}
        weather={weather || undefined}
        isLive
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-y-auto sm:overflow-hidden">
        {/* Track section */}
        <div className="sm:flex-1 relative">
          {isMobile && (
            <button
              onClick={() => setMobileTrackOpen(!mobileTrackOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
            >
              <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
              <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileTrackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}

          {(!isMobile || mobileTrackOpen) && (
            <div className="h-[42vh] sm:h-full relative">
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

              {/* Live badge */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 rounded text-xs font-extrabold text-white">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  LIVE
                </div>
                {!connected && (
                  <span className="px-2 py-1 bg-yellow-600/80 rounded text-xs font-bold text-white">
                    Reconnecting...
                  </span>
                )}
              </div>

              {/* Lap counter */}
              {frame && frame.lap > 0 && (
                <div className="absolute top-3 left-3 z-10 px-2.5 py-1 bg-f1-card/90 border border-f1-border rounded text-xs font-bold text-white">
                  Lap {frame.lap}{frame.total_laps > 0 ? `/${frame.total_laps}` : ""}
                </div>
              )}

              <TrackCanvas
                trackPoints={trackPoints}
                rotation={0}
                trackStatus={trackStatus}
                drivers={drivers
                  .filter((d) => !d.retired && !d.no_timing && (d.x !== 0 || d.y !== 0))
                  .map((d) => ({
                    abbr: d.abbr,
                    x: d.x,
                    y: d.y,
                    color: d.color,
                    position: d.position,
                  }))}
                highlightedDrivers={selectedDrivers}
                playbackSpeed={1}
                showDriverNames={settings.showDriverNames}
              />
            </div>
          )}
        </div>

        {/* Leaderboard */}
        {settings.showLeaderboard && (
          <div className={`flex-shrink-0 ${isMobile ? "" : "border-l"} border-f1-border`} style={{ width: isMobile ? "100%" : leaderboardWidth }}>
            {isMobile && (
              <button
                onClick={() => setMobileLeaderboardOpen(!mobileLeaderboardOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileLeaderboardOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}

            {(!isMobile || mobileLeaderboardOpen) && (
              <Leaderboard
                drivers={drivers}
                highlightedDrivers={selectedDrivers}
                onDriverClick={handleDriverClick}
                settings={settings}
                currentTime={0}
                isRace={isRace}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom bar with status info */}
      <div className="h-10 bg-f1-card border-t border-f1-border flex items-center px-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
          <span className="text-[11px] text-f1-muted font-medium">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
        <span className="text-[11px] text-f1-muted">
          Data via OpenF1 (free tier, ~30s delay)
        </span>
        <div className="flex-1" />
        <a href="/" className="text-[11px] text-f1-muted hover:text-white transition-colors font-medium">
          Replay Mode
        </a>
      </div>
    </div>
  );
}
