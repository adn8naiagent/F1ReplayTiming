"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useSettings } from "@/hooks/useSettings";
import { apiFetch } from "@/lib/api";
import { useAppConfig } from "@/lib/config";
import SessionBanner from "@/components/SessionBanner";
import TrackCanvas from "@/components/TrackCanvas";
import TeamRadio from "@/components/TeamRadio";
import Leaderboard from "@/components/Leaderboard";
import PiPWindow from "@/components/PiPWindow";
import { Maximize, Minimize, ArrowUpRight } from "lucide-react";

interface TrackData {
  track_points: { x: number; y: number }[];
  rotation: number;
  circuit_name: string;
  sector_boundaries?: { s1_end: number; s2_end: number; total: number } | null;
  corners?: { x: number; y: number; number: number; letter: string; angle: number }[] | null;
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

const DELAY_MIN = -300;
const DELAY_MAX = 10;
const DELAY_TICK_PERCENT = (-DELAY_MIN / (DELAY_MAX - DELAY_MIN)) * 100;

function clampDelay(value: number): number {
  return Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.round(value * 2) / 2));
}

function formatDelayValue(s: number): string {
  if (Math.abs(s) < 60) return s.toFixed(1);
  const sign = s < 0 ? "−" : "+";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.round(abs % 60);
  return `${sign}${m}:${String(sec).padStart(2, "0")}`;
}

function formatDelayUnit(s: number): string {
  return Math.abs(s) < 60 ? "seconds" : "min:sec";
}

function formatDelayShort(s: number): string {
  if (s === 0) return "0s";
  if (Math.abs(s) < 60) return `${s > 0 ? "+" : ""}${s}s`;
  const sign = s < 0 ? "−" : "+";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.round(abs % 60);
  return sec === 0 ? `${sign}${m}m` : `${sign}${m}:${String(sec).padStart(2, "0")}`;
}

function LiveTiming() {
  const searchParams = useSearchParams();
  const year = Number(searchParams.get("year"));
  const round = Number(searchParams.get("round"));
  const sessionType = searchParams.get("type") || "R";

  if (!year || !round) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }
  const speed = Number(searchParams.get("speed") || "10");
  const devMode = searchParams.get("dev") === "1";

  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTrackOpen, setMobileTrackOpen] = useState(true);
  const [mobileLeaderboardOpen, setMobileLeaderboardOpen] = useState(true);
  const [mobileRcOpen, setMobileRcOpen] = useState(true);
  const [leaderboardScale, setLeaderboardScale] = useState(1);
  const [delayOffset, setDelayOffset] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = localStorage.getItem("f1live_delay");
      return saved ? Number(saved) : 0;
    } catch { return 0; }
  });
  const [showDelaySlider, setShowDelaySlider] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipTrackOpen, setPipTrackOpen] = useState(true);
  const [pipRcOpen, setPipRcOpen] = useState(true);
  const [pipLeaderboardOpen, setPipLeaderboardOpen] = useState(true);
  const [rcPanelOpen, setRcPanelOpen] = useState(false);
  const [rcPanelSize, setRcPanelSize] = useState<"sm" | "md" | "lg">("md");
  const [rcPosition, setRcPosition] = useState<{ x: number; y: number } | null>(null);
  const rcDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const rcPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem("f1live_delay", String(delayOffset)); } catch {}
  }, [delayOffset]);

  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const onRcDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const panel = rcPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    rcDragRef.current = { startX: clientX, startY: clientY, origX: rect.left, origY: rect.top };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault();
      if (!rcDragRef.current) return;
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - rcDragRef.current.startX;
      const dy = cy - rcDragRef.current.startY;
      setRcPosition({ x: rcDragRef.current.origX + dx, y: rcDragRef.current.origY + dy });
    };
    const onUp = () => {
      rcDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }, []);

  function handleDriverClick(abbr: string) {
    setSelectedDrivers((prev) => {
      if (prev.includes(abbr)) {
        return prev.filter((d) => d !== abbr);
      }
      if (prev.length >= 2) {
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

  const live = useLiveSocket(year, round, sessionType, speed, delayOffset);

  // Wake Lock — prevent screen sleep during live sessions
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then((lock) => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    }
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  const sessionTypeUpper = sessionType.toUpperCase();
  const isRace = sessionTypeUpper === "R" || sessionTypeUpper === "S";
  const isQualifying = sessionTypeUpper === "Q" || sessionTypeUpper === "SQ";

  // RC sound notification
  const lastRcCountRef = useRef(0);
  useEffect(() => {
    const msgs = live.rcMessages || [];
    if (msgs.length > lastRcCountRef.current && lastRcCountRef.current > 0 && settings.rcSound) {
      try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.stop(ctx.currentTime + 0.15);
      } catch {}
    }
    lastRcCountRef.current = msgs.length;
  }, [live.rcMessages?.length, settings.rcSound]);

  // Show loading only while the WebSocket is connecting
  if (live.loading) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin mb-6" />
          <p className="text-f1-muted text-lg">Connecting to live timing...</p>
        </div>
      </div>
    );
  }

  if (live.error) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-bold mb-2">Live Timing Unavailable</p>
          <p className="text-f1-muted mb-6 text-sm">{live.error}</p>
          <a href="/" className="inline-block px-4 py-2 bg-f1-red text-white font-bold text-sm rounded hover:bg-red-700 transition-colors">
            Back to session picker
          </a>
        </div>
      </div>
    );
  }

  // Session ended - no longer block the view; show inline banner instead

  const trackPoints = trackData?.track_points || [];
  const rotation = trackData?.rotation || 0;
  const driversRaw = live.frame?.drivers || [];
  const drivers = isQualifying ? driversRaw.filter((d) => !d.retired) : driversRaw;
  const trackStatus = live.frame?.status || "green";
  const weather = live.frame?.weather;

  // Session hasn't started yet (connected but no driver data)
  const waitingForSession = live.ready && drivers.length === 0;

  // Calculate leaderboard width
  const leaderboardWidth = (() => {
    let w = 106;
    if (settings.showTeamAbbr) w += 28;
    if (!isRace) w += 18;
    if (isRace && settings.showGridChange) w += 24;
    if (!isRace && settings.showBestLapTime) w += 60; // best lap time column
    if (settings.showLastLapTime) w += 60; // last lap time column
    if (settings.showGapToLeader) w += 56 + (!isRace ? 8 : 0); // extra margin between lap time and gap in practice/qualifying
    if (!isRace && settings.showSectors) w += 36; // sector indicators (practice + qualifying)
    if (isRace && settings.showPitStops) w += 24;
    if (isRace && settings.showTyreHistory) w += 36;
    if (settings.showTyreType) w += 24;
    if (settings.showTyreAge) w += 20;
    if (isRace && settings.showPitPrediction) w += 40;
    if (isRace && settings.showPitPrediction && settings.showPitFreeAir) w += 36;
    return w;
  })();

  return (
    <div className="h-dvh flex flex-col bg-f1-dark overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Banner */}
      {!fullscreen && sessionData && (
        <SessionBanner
          eventName={sessionData.event_name}
          circuit={sessionData.circuit}
          country={sessionData.country}
          sessionType={sessionType}
          year={year}
          settings={settings}
          onSettingChange={updateSetting}
          weather={weather}
          extraActions={
            <a
              href="/"
              className="px-2 py-1 sm:px-3 rounded text-[10px] sm:text-xs font-bold text-f1-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              Exit
            </a>
          }
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-y-auto sm:overflow-hidden">
        {/* Track section */}
        <div className="sm:flex-1 relative">
          {/* Mobile section header */}
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
              {/* Waiting for session overlay */}
              {waitingForSession && (
                <div className="absolute inset-0 z-30 flex items-center justify-center">
                  <div className="bg-f1-card/95 border border-f1-border rounded-lg px-8 py-6 backdrop-blur-sm text-center">
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-sm font-bold text-red-400 uppercase">Live</span>
                    </div>
                    <p className="text-white text-lg font-bold mb-2">Waiting for session to start</p>
                    <p className="text-f1-muted text-sm">
                      Live timing data will appear automatically when the session begins.
                    </p>
                  </div>
                </div>
              )}

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

              {/* LIVE badge + Race Control toggle */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <button
                  onClick={() => setRcPanelOpen(!rcPanelOpen)}
                  className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors ${
                    rcPanelOpen
                      ? "bg-orange-500 text-white"
                      : "bg-f1-card/90 border border-f1-border text-f1-muted hover:text-white backdrop-blur-sm"
                  }`}
                  title="Race Control Messages"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
                  </svg>
                  RC
                </button>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded text-xs font-extrabold text-white uppercase">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  LIVE
                </div>
              </div>

              {/* Race Control Messages panel */}
              {rcPanelOpen && (
                <div
                  ref={rcPanelRef}
                  className={`z-20 w-80 bg-f1-card/95 border border-f1-border rounded-lg shadow-xl backdrop-blur-sm overflow-hidden flex flex-col ${
                    rcPanelSize === "sm" ? "max-h-[25%]" : rcPanelSize === "md" ? "max-h-[50%]" : "max-h-[85%]"
                  }`}
                  style={rcPosition
                    ? { position: "fixed", left: rcPosition.x, top: rcPosition.y }
                    : { position: "absolute", top: 48, right: 12 }
                  }
                >
                  <div
                    className="flex items-center justify-between px-3 py-2 border-b border-f1-border flex-shrink-0 cursor-grab active:cursor-grabbing"
                    style={{ touchAction: "none" }}
                    onMouseDown={onRcDragStart}
                    onTouchStart={onRcDragStart}
                  >
                    <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
                    <div className="flex items-center gap-1">
                      {(["sm", "md", "lg"] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setRcPanelSize(size)}
                          className={`w-5 h-4 flex items-center justify-center rounded text-[8px] font-bold transition-colors ${
                            rcPanelSize === size ? "bg-f1-muted/30 text-white" : "text-f1-muted hover:text-white"
                          }`}
                          title={size === "sm" ? "Compact" : size === "md" ? "Medium" : "Expanded"}
                        >
                          {size === "sm" ? (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="6" width="10" height="5" rx="1" /></svg>
                          ) : size === "md" ? (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="3" width="10" height="8" rx="1" /></svg>
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="1" y="1" width="10" height="10" rx="1" /></svg>
                          )}
                        </button>
                      ))}
                      {rcPosition && (
                        <button onClick={() => setRcPosition(null)} className="text-f1-muted hover:text-white ml-1" title="Reset position">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setRcPanelOpen(false)} className="text-f1-muted hover:text-white ml-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-f1-border/50">
                    {(live.rcMessages || []).length === 0 ? (
                      <p className="text-f1-muted text-xs p-3 text-center">No race control messages yet</p>
                    ) : (
                      (rcPanelSize === "sm" ? (live.rcMessages || []).slice(0, 1) : (live.rcMessages || [])).map((rc, i) => {
                        const isInvestigation = rc.message.toUpperCase().includes("INVESTIGATION") || rc.message.toUpperCase().includes("NOTED");
                        const isPenalty = rc.message.toUpperCase().includes("PENALTY") && !rc.message.toUpperCase().includes("NO FURTHER");
                        const isCleared = rc.message.toUpperCase().includes("NO FURTHER") || rc.message.toUpperCase().includes("NO INVESTIGATION");
                        return (
                          <div key={i} className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                              }`} />
                              <div className="min-w-0">
                                <p className="text-[11px] text-white leading-tight">{rc.message}</p>
                                {rc.lap && (
                                  <span className="text-[9px] text-f1-muted">Lap {rc.lap}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <TeamRadio
                enabled={settings.showTeamRadio}
                audio={!settings.teamRadioMuted}
                clips={live.frame?.team_radio}
                mode="live"
                drivers={drivers}
              />

              {/* Live positions unavailable overlay (positions arrive with an F1 TV sign-in) */}
              {!drivers.some((d) => d.x !== 0 || d.y !== 0) && (
              <div className="absolute inset-0 z-10 flex items-end justify-center pointer-events-none pb-4">
                <div className="bg-f1-card/90 border border-f1-border rounded-lg px-4 py-2.5 backdrop-blur-sm text-center max-w-sm">
                  <p className="text-f1-muted text-xs leading-relaxed">
                    Driver track positions and telemetry are not available during live sessions.
                    These will be available in replay once the session is processed.
                  </p>
                </div>
              </div>
              )}

              {trackPoints.length > 0 ? (
                <TrackCanvas
                  trackPoints={trackPoints}
                  rotation={rotation}
                  trackStatus={trackStatus}
                  drivers={drivers.filter((d) => !d.retired && !d.no_timing && (d.x !== 0 || d.y !== 0)).map((d) => ({
                    abbr: d.abbr,
                    x: d.x,
                    y: d.y,
                    color: d.color,
                    position: d.position,
                  }))}
                  highlightedDrivers={selectedDrivers}
                  playbackSpeed={1}
                  showDriverNames={settings.showDriverNames}
                  corners={settings.showCorners ? trackData?.corners : null}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-f1-muted text-sm">Track data not available</p>
                </div>
              )}

              {/* Fullscreen toggle - top-left */}
              {!isMobile && (
                <button
                  onClick={() => {
                    const next = !fullscreen;
                    setFullscreen(next);
                    if (next && document.documentElement.requestFullscreen) {
                      document.documentElement.requestFullscreen();
                    } else if (!next && document.fullscreenElement) {
                      document.exitFullscreen();
                    }
                  }}
                  className="absolute top-3 left-3 z-20 px-2 py-1 bg-f1-card/90 border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-white transition-colors backdrop-blur-sm"
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Race Control section - mobile only */}
        <div className="sm:hidden">
          <button
            onClick={() => setMobileRcOpen(!mobileRcOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
          >
            <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
            <svg className={`w-4 h-4 text-f1-muted transition-transform ${mobileRcOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {mobileRcOpen && (() => {
            const latest = (live.rcMessages || [])[0];
            if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
            const upper = latest.message.toUpperCase();
            const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
            const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
            const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
            return (
              <div className="px-3 py-2 bg-f1-card border-b border-f1-border">
                <div className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                  }`} />
                  <div className="min-w-0">
                    <p className="text-[11px] text-white leading-tight">{latest.message}</p>
                    {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Leaderboard section */}
        {settings.showLeaderboard && (
          <div className={`flex-shrink-0 ${isMobile ? "" : "border-l"} border-f1-border`} style={{ width: isMobile ? "100%" : Math.ceil(leaderboardWidth * leaderboardScale) }}>
            {/* Mobile section header */}
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
                currentTime={live.frame?.timestamp || 0}
                isRace={isRace}
                isQualifying={isQualifying}
                onScaleChange={setLeaderboardScale}
              />
            )}
          </div>
        )}
      </div>

      {/* Live info bar (replaces playback controls) */}
      <div className="flex-shrink-0 bg-f1-card border-t border-f1-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Lap counter */}
          {isRace && live.frame && (
            <div className="text-sm">
              <span className="text-f1-muted">Lap </span>
              <span className="text-white font-bold">{live.frame.lap}</span>
              {live.frame.total_laps > 0 && (
                <span className="text-f1-muted">/{live.frame.total_laps}</span>
              )}
            </div>
          )}

          {/* Dev controls (test replayer only — add ?dev=1 to URL) */}
          {devMode && live.frame && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-f1-muted">
                {(() => {
                  const t = live.frame.timestamp;
                  const h = Math.floor(t / 3600);
                  const m = Math.floor((t % 3600) / 60);
                  const s = Math.floor(t % 60);
                  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                })()}
              </span>
              <div className="flex items-center gap-1">
                {[60, 300, 600, 1800].map((s) => (
                  <button
                    key={s}
                    onClick={() => live.send(JSON.stringify({ command: "skip", seconds: s }))}
                    className="px-1.5 py-0.5 bg-f1-dark border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-white hover:border-f1-muted transition-colors"
                  >
                    +{s >= 60 ? `${s / 60}m` : `${s}s`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Qualifying phase */}
          {isQualifying && live.frame?.quali_phase && (
            <div className="text-sm">
              <span className="text-white font-bold">{live.frame.quali_phase.phase}</span>
              {live.frame.quali_phase.remaining > 0 && (
                <span className="text-f1-muted ml-2">
                  {Math.floor(live.frame.quali_phase.remaining / 60)}:
                  {String(Math.floor(live.frame.quali_phase.remaining % 60)).padStart(2, "0")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Broadcast delay */}
          <div className="relative">
            <button
              onClick={() => setShowDelaySlider(!showDelaySlider)}
              className={`px-2 py-1 border rounded text-[10px] font-bold transition-colors ${
                delayOffset !== 0
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                  : "bg-f1-dark border-f1-border text-f1-muted hover:text-white"
              }`}
            >
              Delay: {formatDelayShort(delayOffset)}
            </button>
            {showDelaySlider && (<>
              {/* Modal backdrop */}
              <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowDelaySlider(false)} />

              {/* Delay modal */}
              <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 sm:w-[360px] bg-[#1A1A26] border border-f1-border rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-f1-border">
                  <span className="text-sm font-bold text-white">Broadcast Delay</span>
                  <button onClick={() => setShowDelaySlider(false)} className="text-f1-muted hover:text-white">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="px-3 sm:px-5 py-3 sm:py-4 space-y-3 sm:space-y-4">
                  {/* Current value display */}
                  <div className="text-center">
                    <span className="text-3xl font-extrabold text-white tabular-nums">{formatDelayValue(delayOffset)}</span>
                    <span className="text-lg text-f1-muted ml-1">{formatDelayUnit(delayOffset)}</span>
                  </div>

                  {/* Slider */}
                  {/* Slider with zero tick mark */}
                  <div className="relative">
                    <input
                      type="range"
                      min={DELAY_MIN}
                      max={DELAY_MAX}
                      step={0.5}
                      value={delayOffset}
                      onChange={(e) => setDelayOffset(Number(e.target.value))}
                      className="w-full h-1.5 bg-f1-border rounded-lg appearance-none cursor-pointer accent-blue-500 relative z-10"
                    />
                    {/* Zero tick — positioned absolutely over the slider */}
                    <div
                      className="absolute pointer-events-none z-20"
                      style={{ left: `calc(${DELAY_TICK_PERCENT}% - 7px)`, top: "calc(50% + 3px)", transform: "translate(-50%, -50%)" }}
                    >
                      <div className="w-px h-4 bg-white/40" />
                    </div>
                  </div>
                  <div className="relative flex justify-between text-[10px] text-f1-muted mt-1">
                    <span>-5m</span>
                    <span>0s</span>
                  </div>

                  {/* Quick adjust buttons */}
                  <div className="flex items-center justify-center gap-1">
                    {[
                      { label: "-30s", delta: -30 },
                      { label: "-5s", delta: -5 },
                      { label: "-1s", delta: -1 },
                      { label: "-0.5s", delta: -0.5 },
                      { label: "+0.5s", delta: 0.5 },
                      { label: "+1s", delta: 1 },
                      { label: "+5s", delta: 5 },
                      { label: "+30s", delta: 30 },
                    ].map(({ label, delta }, i) => (
                      <button
                        key={label}
                        onClick={() => setDelayOffset(clampDelay(delayOffset + delta))}
                        className={`px-1.5 py-1.5 bg-f1-dark border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-white hover:border-blue-500/50 transition-colors ${i === 4 ? "ml-1.5" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Manual input */}
                  <div className="flex items-center justify-center gap-2">
                    <label className="text-xs text-f1-muted">Exact:</label>
                    <div className="flex items-center bg-f1-dark border border-f1-border rounded overflow-hidden focus-within:border-blue-500">
                      <button
                        id="delay-sign-btn"
                        onClick={() => {
                          const btn = document.getElementById("delay-sign-btn") as HTMLButtonElement;
                          const current = btn.textContent === "−" ? "−" : "+";
                          btn.textContent = current === "−" ? "+" : "−";
                        }}
                        className="px-2 py-1.5 text-sm font-bold text-f1-muted hover:text-white border-r border-f1-border transition-colors w-8 text-center"
                      >
                        −
                      </button>
                      <input
                        id="delay-exact-input"
                        type="text"
                        inputMode="decimal"
                        onFocus={(e) => { e.target.value = ""; }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const raw = (e.target as HTMLInputElement).value;
                            if (raw === "") return;
                            const v = Math.abs(Number(raw));
                            if (isNaN(v)) return;
                            const sign = (document.getElementById("delay-sign-btn") as HTMLButtonElement)?.textContent === "−" ? -1 : 1;
                            setDelayOffset(clampDelay(v * sign));
                            (e.target as HTMLInputElement).value = "";
                          }
                        }}
                        className="w-16 px-2 py-1.5 bg-transparent text-sm text-white text-center focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const input = document.getElementById("delay-exact-input") as HTMLInputElement;
                        if (!input || input.value === "") return;
                        const v = Math.abs(Number(input.value));
                        if (isNaN(v)) return;
                        const sign = (document.getElementById("delay-sign-btn") as HTMLButtonElement)?.textContent === "−" ? -1 : 1;
                        setDelayOffset(clampDelay(v * sign));
                        input.value = "";
                      }}
                      className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded transition-colors"
                    >
                      Set
                    </button>
                  </div>

                  <p className="text-[10px] text-f1-muted leading-relaxed text-center">
                    Pauses the live data feed until it aligns with your broadcast. Set this to match the delay of your streaming service.
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setDelayOffset(0); }}
                      className="flex-1 px-3 py-2 bg-f1-dark border border-f1-border text-f1-muted hover:text-white text-xs font-bold rounded transition-colors"
                    >
                      Reset to 0
                    </button>
                    <button
                      onClick={() => setShowDelaySlider(false)}
                      className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded transition-colors"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </div>
            </>)}
          </div>

          {/* Live indicator + PiP */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-red-400 uppercase">Live</span>
            </div>
            {!isMobile && !isIOS && (
              <button
                onClick={() => setPipActive(!pipActive)}
                className={`px-3 py-1.5 rounded border transition-colors text-xs font-bold ${
                  pipActive
                    ? "border-f1-red text-f1-red hover:bg-f1-red/10"
                    : "border-f1-border text-f1-muted hover:text-white hover:bg-white/10"
                }`}
                title="Picture-in-Picture"
              >
                <svg className="w-4 h-4 inline-block mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <rect x="12" y="10" width="10" height="10" rx="1" fill="currentColor" opacity="0.3" />
                </svg>
                PiP
              </button>
            )}
          </div>
        </div>
      </div>

      {/* PiP window */}
      {pipActive && !isMobile && !isIOS && (
        <PiPWindow onClose={() => setPipActive(false)} width={400} height={720}>
          <div className="flex flex-col h-full bg-f1-dark">
            {/* PiP Track Map */}
            <div>
              <button
                onClick={() => setPipTrackOpen(!pipTrackOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Track Map</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipTrackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipTrackOpen && (
                <div className="relative" style={{ height: "40vh" }}>
                  {trackStatus !== "green" && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                      <div
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
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
                    drivers={[]}
                    highlightedDrivers={selectedDrivers}
                    showDriverNames={settings.showDriverNames}
                    corners={settings.showCorners ? trackData?.corners : null}
                  />
                </div>
              )}
            </div>

            {/* PiP Race Control */}
            <div className="border-t border-f1-border">
              <button
                onClick={() => setPipRcOpen(!pipRcOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Race Control</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipRcOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipRcOpen && (() => {
                const latest = (live.rcMessages || [])[0];
                if (!latest) return <p className="text-f1-muted text-xs px-3 py-2">No messages yet</p>;
                const upper = latest.message.toUpperCase();
                const isPenalty = upper.includes("PENALTY") && !upper.includes("NO FURTHER");
                const isInvestigation = upper.includes("INVESTIGATION") || upper.includes("NOTED");
                const isCleared = upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION");
                return (
                  <div className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        isPenalty ? "bg-red-500" : isInvestigation ? "bg-orange-400" : isCleared ? "bg-green-500" : "bg-f1-muted"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white leading-tight">{latest.message}</p>
                        {latest.lap && <span className="text-[9px] text-f1-muted">Lap {latest.lap}</span>}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* PiP Leaderboard */}
            <div className="flex-1 min-h-0 flex flex-col border-t border-f1-border">
              <button
                onClick={() => setPipLeaderboardOpen(!pipLeaderboardOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-f1-card border-b border-f1-border flex-shrink-0"
              >
                <span className="text-[11px] font-bold text-f1-muted uppercase tracking-wider">Leaderboard</span>
                <svg className={`w-4 h-4 text-f1-muted transition-transform ${pipLeaderboardOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pipLeaderboardOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <Leaderboard
                    drivers={drivers}
                    highlightedDrivers={selectedDrivers}
                    onDriverClick={handleDriverClick}
                    settings={settings}
                    currentTime={live.frame?.timestamp || 0}
                    isRace={isRace}
                    isQualifying={isQualifying}
                    compact
                  />
                </div>
              )}
            </div>
          </div>
        </PiPWindow>
      )}
    </div>
  );
}

// Live timing is switched off on public sites: send visitors to the session picker.
export default function LivePage() {
  const config = useAppConfig();
  const disabled = !!config && !config.live;
  useEffect(() => {
    if (disabled) window.location.replace("/");
  }, [disabled]);
  if (!config || disabled) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-f1-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <LiveTiming />;
}
