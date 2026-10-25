"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { f1tv, type F1TVChannel, type F1TVContent } from "@/lib/f1tv";
import type { ReplayDriver } from "@/hooks/useReplaySocket";
import { useF1TVStream, type StreamDebug, type StreamOptions } from "@/hooks/useF1TVStream";
import { useReplayClock, useVideoSync } from "@/hooks/useVideoSync";

interface Props {
  /** e.g. "2026_14_R" — keys the saved F1 TV link and sync offsets. */
  sessionKey: string;
  timestamp: number | undefined;
  playing: boolean;
  speed: number;
  /** Driver numbers selected in the leaderboard; the first with an onboard is shown. */
  selectedDriverNumbers: string[];
  /** The track map, shown as an overlay in the top corner. */
  trackOverlay: React.ReactNode;
  /** Drivers in the current frame by racing number, for the onboard's telemetry */
  driversByNumber: Record<string, ReplayDriver>;
  /** Told whether onboards (with their own telemetry) are showing */
  onOnboardsChange?: (showing: boolean) => void;
  /** The broadcast's sound (onboards are always muted) */
  muted?: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function isOnboard(c: F1TVChannel) {
  return (c.type || "").toLowerCase() === "obc" || c.driver_number != null;
}

// How far F1 TV's real-time stamp runs ahead of the pictures (measured
// against the engine-sound match)
const STAMP_DELAY_S = 7.7;

export default function BroadcastView({ sessionKey, timestamp, playing, speed, selectedDriverNumbers, trackOverlay, driversByNumber, onOnboardsChange, muted = false }: Props) {
  const linkKey = `f1tv_content_${sessionKey}`;
  const [link, setLink] = useState<string>(() => readJson(linkKey, ""));
  const [linkDraft, setLinkDraft] = useState("");
  // Finding this session on F1 TV automatically; the link box is the fallback
  const [finding, setFinding] = useState<"searching" | "not_found" | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [content, setContent] = useState<F1TVContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const [opts, setOpts] = useState<StreamOptions>(() => readJson("f1tv_stream_opts", { licenceViaServer: true, relay: false }));
  const [mainChannel, setMainChannel] = useState<string | null>(null);
  // Up to two onboards, following the first two drivers selected on the
  // leaderboard. × closes one until the next leaderboard click, or until
  // it's picked in the onboard menu.
  const [onboardChannels, setOnboardChannels] = useState<[string | null, string | null]>([null, null]);
  const [closedOnboards, setClosedOnboards] = useState<Set<string>>(() => new Set());
  const prevSelected = useRef<string[]>(selectedDriverNumbers);
  // Onboards can be turned off; then selecting drivers only highlights them
  const [showOnboard, setShowOnboardState] = useState<boolean>(() => readJson("f1tv_show_onboard", true));
  const setShowOnboard = (update: boolean | ((v: boolean) => boolean)) => {
    setShowOnboardState((v) => {
      const next = typeof update === "function" ? update(v) : update;
      writeJson("f1tv_show_onboard", next);
      return next;
    });
  };
  const [showOverlays, setShowOverlays] = useState(true);
  // The track map over the broadcast, on its own switch (remembered)
  const [showMap, setShowMapState] = useState<boolean>(() => readJson("f1tv_show_map", true));
  const toggleMap = () => setShowMapState((v) => { writeJson("f1tv_show_map", !v); return !v; });
  const [showDebug, setShowDebug] = useState(false);

  const mainRef = useRef<HTMLVideoElement>(null);
  const main = useF1TVStream(mainRef);

  // Sync. The broadcast follows the replay: video time = replay time + offset.
  // The server matches the onboards' engine sound to the timing's RPM for
  // the offset. Where it can't (encrypted audio), the video's real-time
  // stamp is used, which runs a few seconds early; a manual Sync is the
  // last resort. Nudges are remembered per session. The onboards follow
  // the broadcast (F1 TV's feeds share one timeline), with their own nudge.
  const offsetKey = (channel: string | null) => `f1tv_offset_${sessionKey}_${content?.content_id}_${channel ?? "main"}`;
  // (v2: nudges made against the earlier, less accurate sync are dropped)
  const nudgeKey = (which: "main" | "onboard") => `f1tv_nudge2_${sessionKey}_${which}`;
  const [manualOffset, setManualOffset] = useState<number | null>(null);
  const [mainNudge, setMainNudge] = useState<number>(() => readJson(nudgeKey("main"), 0));
  const [onboardNudge, setOnboardNudge] = useState<number>(() => readJson(nudgeKey("onboard"), 0));
  const [replayStart, setReplayStart] = useState<number | null>(null);
  useEffect(() => {
    const [year, round, type] = sessionKey.split("_");
    f1tv.replayStart(Number(year), Number(round), type).then((r) => setReplayStart(r.replay_start_utc)).catch(() => setReplayStart(null));
  }, [sessionKey]);
  const [soundSync, setSoundSync] = useState<{ offset: number; content_id: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const [year, round, type] = sessionKey.split("_");
    let cancelled = false;
    setSoundSync(null);
    setSyncing(true);
    f1tv.sync(Number(year), Number(round), type)
      .then((r) => { if (!cancelled) setSoundSync(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [sessionKey]);
  const videoStart = main.debug.playback?.video_start_utc ?? null;
  const autoOffset =
    soundSync && link.includes(soundSync.content_id)
      ? soundSync.offset
      : replayStart !== null && videoStart !== null
        ? replayStart - videoStart + STAMP_DELAY_S
        : null;
  const mainOffset = autoOffset !== null ? autoOffset + mainNudge : manualOffset;

  const clock = useReplayClock(timestamp, playing, speed);
  const mainDrift = useVideoSync(mainRef, main.state === "ready", clock, playing, speed, mainOffset);
  const broadcastClock = useCallback(() => mainRef.current?.currentTime ?? 0, []);
  const broadcastPlaying = mainOffset !== null ? playing : !!mainRef.current && !mainRef.current.paused;

  useEffect(() => writeJson("f1tv_stream_opts", opts), [opts]);
  useEffect(() => {
    if (mainRef.current) mainRef.current.muted = muted;
  }, [muted, main.state]);

  // No saved link: find this session's replay on F1 TV.
  useEffect(() => {
    if (link || manual) return;
    const [year, round, type] = sessionKey.split("_");
    let cancelled = false;
    setFinding("searching");
    f1tv.find(Number(year), Number(round), type)
      .then((found) => {
        if (cancelled) return;
        setFinding(null);
        setLink(found.content_id);
        writeJson(linkKey, found.content_id);
      })
      .catch((e) => {
        if (cancelled) return;
        setFinding("not_found");
        setFindError(e.message);
      });
    return () => { cancelled = true; };
  }, [link, manual, sessionKey, linkKey]);

  // Look up the feeds for the saved link.
  useEffect(() => {
    if (!link) return;
    setContentError(null);
    f1tv.content(link).then(setContent).catch((e) => {
      setContent(null);
      setContentError(e.message);
    });
  }, [link]);

  const onboards = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && isOnboard(c)), [content]);
  const shownOnboards = showOnboard ? onboardChannels.filter((c): c is string => !!c) : [];
  const onboardVisible = shownOnboards.length > 0 && showOverlays;
  useEffect(() => {
    onOnboardsChange?.(onboardVisible);
    return () => onOnboardsChange?.(false);
  }, [onboardVisible, onOnboardsChange]);
  const driverOf = (channel: string) => {
    const c = onboards.find((o) => o.channel_id === channel);
    return c?.driver_number != null ? driversByNumber[String(c.driver_number)] : undefined;
  };
  const mainFeeds = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && !isOnboard(c)), [content]);

  // Follow the leaderboard selection: an onboard for each of the first two
  // selected drivers. Any leaderboard click reopens closed onboards.
  useEffect(() => {
    const changed = selectedDriverNumbers.join() !== prevSelected.current.join();
    prevSelected.current = selectedDriverNumbers;
    const closed = changed ? new Set<string>() : closedOnboards;
    if (changed) {
      setClosedOnboards(closed);
      if (selectedDriverNumbers.length) setShowOnboard(true);
    }
    const matches = selectedDriverNumbers
      .map((n) => onboards.find((c) => String(c.driver_number) === n)?.channel_id ?? null)
      .filter((c): c is string => !!c && !closed.has(c))
      .slice(0, 2);
    if (matches.length || selectedDriverNumbers.length) setOnboardChannels([matches[0] ?? null, matches[1] ?? null]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriverNumbers, onboards]);

  const closeOnboard = (channel: string) => {
    setClosedOnboards((s) => new Set(s).add(channel));
    setOnboardChannels(([a, b]) => (a === channel ? [b, null] : [a, b === channel ? null : b]));
  };

  // (Re)load the main feed.
  useEffect(() => {
    if (!link || !content) return;
    setManualOffset(readJson<number | null>(offsetKey(mainChannel), null));
    void main.load(link, mainChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, mainChannel, opts]);

  // Manual sync, only when the automatic offset isn't available
  const syncHere = useCallback(() => {
    const video = mainRef.current;
    if (!video) return;
    const offset = video.currentTime - clock();
    setManualOffset(offset);
    writeJson(offsetKey(mainChannel), offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, mainChannel, content]);

  const nudge = (which: "main" | "onboard", by: number) => {
    if (which === "onboard") {
      const next = onboardNudge + by;
      setOnboardNudge(next);
      writeJson(nudgeKey("onboard"), next);
    } else if (autoOffset !== null) {
      const next = mainNudge + by;
      setMainNudge(next);
      writeJson(nudgeKey("main"), next);
    } else if (manualOffset !== null) {
      setManualOffset(manualOffset + by);
      writeJson(offsetKey(mainChannel), manualOffset + by);
    }
  };

  const resetSync = (which: "main" | "onboard") => {
    if (which === "onboard") {
      setOnboardNudge(0);
      writeJson(nudgeKey("onboard"), 0);
    } else if (autoOffset !== null) {
      setMainNudge(0);
      writeJson(nudgeKey("main"), 0);
    } else {
      setManualOffset(null);
      writeJson(offsetKey(mainChannel), null);
    }
  };

  // "h" hides the overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "h") setShowOverlays((v) => !v);
      if (e.key === "m") toggleMap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!link && finding === "searching") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <p className="text-xs text-f1-muted">Finding this session on F1 TV…</p>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="max-w-md w-full px-6 space-y-3">
          <p className="text-sm text-white font-bold">Watch the F1 TV broadcast</p>
          {finding === "not_found" && !manual && (
            <p className="text-xs text-yellow-400 leading-relaxed">{findError}</p>
          )}
          <p className="text-xs text-f1-muted leading-relaxed">
            Open this session on f1tv.formula1.com and paste the link from the address bar.
          </p>
          <div className="flex gap-2">
            <input
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              placeholder="https://f1tv.formula1.com/detail/…"
              className="flex-1 bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-f1-muted"
            />
            <button
              onClick={() => {
                setLink(linkDraft.trim());
                writeJson(linkKey, linkDraft.trim());
              }}
              disabled={!linkDraft.trim()}
              className="px-3 py-1.5 bg-f1-red text-white text-xs font-bold rounded disabled:opacity-50"
            >
              Load
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectClass = "bg-f1-card/90 border border-f1-border rounded px-1.5 py-1 text-[10px] text-white focus:outline-none";
  const btnClass = "px-2 py-1 bg-f1-card/90 border border-f1-border rounded text-[10px] font-bold text-f1-muted hover:text-white";

  return (
    <div className="relative w-full h-full bg-black overflow-hidden group">
      {/* Protected video can be drawn in its own hardware layer that ignores
          stacking, so the onboard never overlaps the broadcast: with an
          onboard showing, the broadcast takes the left and the onboard and
          map a column on the right. */}
      <video
        ref={mainRef}
        className={`absolute inset-y-0 left-0 h-full object-contain ${onboardVisible ? "w-[70%]" : "w-full"}`}
        playsInline
      />

      {main.state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-f1-muted">
            {contentError || (main.state === "error" ? main.debug.error?.message : "Loading broadcast…")}
          </p>
        </div>
      )}

      {/* Right-hand column beside the broadcast: up to two onboards, then
          the map. Starts below the page's hover buttons (Track map /
          Broadcast, RC) so they never cover an onboard's ×. */}
      {onboardVisible ? (
        <div className="absolute top-12 bottom-3 right-3 z-20 w-[calc(30%-1.5rem)] flex flex-col gap-2">
          {shownOnboards.map((channel) => (
            <OnboardPane
              key={channel}
              link={link}
              channel={channel}
              opts={opts}
              mainRef={mainRef}
              mainReady={main.state === "ready"}
              playing={broadcastPlaying}
              speed={mainOffset !== null ? speed : 1}
              replaySpeed={speed}
              nudge={onboardNudge}
              driver={driverOf(channel)}
              onClose={() => closeOnboard(channel)}
            />
          ))}
          {showMap && (
            // A fixed size, so it stays readable; the onboards scale around it
            <div className="flex-shrink-0 h-[clamp(170px,38%,300px)] flex justify-center pointer-events-none">
              <div className="h-full max-w-full aspect-square [&_.bg-f1-dark]:!bg-transparent">{trackOverlay}</div>
            </div>
          )}
        </div>
      ) : showOverlays && showMap && (
        // Just the track lines over the video: the map's own background is
        // made transparent here
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-[26%] max-w-[340px] aspect-square pointer-events-none [&_.bg-f1-dark]:!bg-transparent">
          {trackOverlay}
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1.5">
          {mainFeeds.length > 0 && (
            <select value={mainChannel ?? ""} onChange={(e) => setMainChannel(e.target.value || null)} className={selectClass}>
              <option value="">Main feed</option>
              {mainFeeds.map((c) => (
                <option key={c.channel_id!} value={c.channel_id!}>{c.title}</option>
              ))}
            </select>
          )}
          {mainOffset === null ? (
            <button onClick={syncHere} className={`${btnClass} !text-white !bg-f1-red border-f1-red`} title="Line the video up with the timing, then press">
              Sync broadcast here
            </button>
          ) : (
            <>
              <button onClick={() => nudge("main", -5)} className={btnClass} title="Video earlier against the timing">−5s</button>
              <button onClick={() => nudge("main", -0.5)} className={btnClass} title="Video earlier against the timing">−0.5s</button>
              <button onClick={() => nudge("main", 0.5)} className={btnClass} title="Video later against the timing">+0.5s</button>
              <button onClick={() => nudge("main", 5)} className={btnClass} title="Video later against the timing">+5s</button>
              {mainNudge !== 0 && <span className="text-[10px] font-bold text-white/80 bg-black/60 rounded px-1.5 py-1 tabular-nums">{mainNudge > 0 ? "+" : ""}{mainNudge}s</span>}
              <button onClick={() => resetSync("main")} className={btnClass}>{autoOffset !== null ? "Reset sync" : "Re-sync"}</button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {([0, 1] as const).map((slot) => (
            <select
              key={slot}
              value={onboardChannels[slot] ?? ""}
              onChange={(e) => {
                const next: [string | null, string | null] = [...onboardChannels];
                next[slot] = e.target.value || null;
                setOnboardChannels(next);
                if (e.target.value) setClosedOnboards((s) => { const n = new Set(s); n.delete(e.target.value); return n; });
                // Picking one here is asking to see it, even if onboards were hidden
                if (e.target.value) setShowOnboard(true);
              }}
              className={selectClass}
            >
              <option value="">{slot === 0 ? "No onboard" : "No second onboard"}</option>
              {onboards.map((c) => (
                <option key={c.channel_id!} value={c.channel_id!}>
                  {c.driver_number ? `${c.driver_number} ` : ""}{c.driver_name || c.title}
                </option>
              ))}
            </select>
          ))}
          {onboardChannels.some(Boolean) && (
            <>
              <button onClick={() => nudge("onboard", -0.5)} className={btnClass}>−0.5s</button>
              <button onClick={() => nudge("onboard", 0.5)} className={btnClass}>+0.5s</button>
              {onboardNudge !== 0 && <button onClick={() => resetSync("onboard")} className={btnClass}>Reset</button>}
              <button onClick={() => setShowOnboard((v) => !v)} className={btnClass}>{showOnboard ? "Hide" : "Show"} onboards</button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={toggleMap} className={btnClass} title="Shortcut: M">
            {showMap ? "Hide" : "Show"} map
          </button>
          <button onClick={() => setShowOverlays((v) => !v)} className={btnClass} title="Hide or show the map and onboards. Shortcut: H">
            {showOverlays ? "Hide" : "Show"} overlays
          </button>
          <button onClick={() => setShowDebug((v) => !v)} className={btnClass}>Debug</button>
          <button
            onClick={() => {
              setManual(true);
              setLink("");
              setContent(null);
              writeJson(linkKey, null);
              void main.unload();
            }}
            className={btnClass}
          >
            Change link
          </button>
        </div>
        {mainOffset === null && syncing && (
          <p className="text-[10px] text-white/80 bg-black/60 rounded px-2 py-1 max-w-[280px]">
            Lining the broadcast up with the timing… The first time for a session takes about a minute.
          </p>
        )}
        {mainOffset === null && !syncing && (
          <p className="text-[10px] text-white/80 bg-black/60 rounded px-2 py-1 max-w-[280px]">
            This session couldn&apos;t be synced automatically. Use the video controls to find the moment that matches the timing (lights out works well), then press Sync.
          </p>
        )}
      </div>

      {/* Unsynced videos need their own controls to line them up. */}
      {mainOffset === null && main.state === "ready" && <NativeControls videoRef={mainRef} />}

      {showDebug && (
        <DebugPanel
          opts={opts}
          setOpts={setOpts}
          main={main.debug}
          onboard={null}
          mainDrift={mainDrift}
          onboardDrift={null}
          content={content}
        />
      )}
    </div>
  );
}

/** One onboard camera, following the broadcast's position. */
function OnboardPane({ link, channel, opts, mainRef, mainReady, playing, speed, replaySpeed, nudge, driver, onClose }: {
  link: string;
  channel: string;
  opts: StreamOptions;
  mainRef: React.RefObject<HTMLVideoElement | null>;
  mainReady: boolean;
  playing: boolean;
  speed: number;
  replaySpeed: number;
  nudge: number;
  driver?: ReplayDriver;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const stream = useF1TVStream(ref);
  const broadcastClock = useCallback(() => mainRef.current?.currentTime ?? 0, [mainRef]);
  useVideoSync(ref, stream.state === "ready" && mainReady, broadcastClock, playing, speed, nudge);
  useEffect(() => {
    void stream.load(link, channel, opts);
    return () => { void stream.unload(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, channel, opts]);

  return (
    // Fills the space the map leaves, as large as fits at 16:9
    <div className="flex-1 min-h-0 flex justify-center [container-type:size]">
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10" style={{ width: "min(100cqw, 100cqh * 16 / 9)" }}>
      <video ref={ref} className="w-full h-full object-contain" muted playsInline />
      <button
        onClick={onClose}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:text-white text-sm leading-none flex items-center justify-center"
        title="Close this onboard (a leaderboard click brings it back)"
        aria-label="Close onboard"
      >
        ×
      </button>
      <OnboardTelemetry driver={driver} speed={replaySpeed} />
      {stream.state === "error" && (
        <p className="absolute inset-0 flex items-center justify-center text-[10px] text-f1-muted p-2 text-center">
          {stream.debug.error?.message}
        </p>
      )}
    </div>
    </div>
  );
}

/** A slim telemetry strip along the bottom of an onboard: driver, speed,
 *  gear, a throttle gauge, a brake tag that lights up, and DRS when open. Replay
 *  frames come every half second of race time, so the gauge glides from one
 *  reading to the next over that time rather than stepping. */
function OnboardTelemetry({ driver, speed }: { driver?: ReplayDriver; speed: number }) {
  if (!driver || driver.speed == null) return null;
  const throttle = Math.max(0, Math.min(100, driver.throttle ?? 0));
  const drsOpen = (driver.drs ?? 0) >= 10;
  const frameMs = Math.round(500 / Math.max(speed, 0.25));
  return (
    <div className="absolute bottom-1.5 inset-x-0 mx-auto w-fit max-w-[calc(100%-0.75rem)] flex items-center gap-2 h-6 pl-1.5 pr-2 rounded-full bg-black/65 backdrop-blur-sm border border-white/10 text-white tabular-nums">
      <span className="w-1 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: driver.color }} />
      <span className="text-[10px] font-extrabold tracking-wide">{driver.abbr}</span>
      <span className="flex items-baseline gap-0.5 w-11 justify-end">
        <span className="text-[13px] font-extrabold leading-none">{Math.round(driver.speed)}</span>
        <span className="text-[7px] font-bold text-white/45">KM/H</span>
      </span>
      <span className="w-4 h-4 flex-shrink-0 rounded-[4px] bg-white text-black text-[10px] font-extrabold flex items-center justify-center leading-none">
        {driver.gear || "N"}
      </span>
      <span className="relative w-14 min-w-6 h-1.5 rounded-full bg-white/10 overflow-hidden" title="Throttle">
        {/* Washed-out green on a light throttle, bright green flat out */}
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] ease-linear"
          style={{
            width: `${throttle}%`,
            backgroundColor: `hsl(${150 - throttle * 0.25} ${25 + throttle * 0.7}% ${62 - throttle * 0.12}%)`,
            transitionDuration: `${frameMs}ms`,
          }}
        />
      </span>
      <span
        className={`px-1 rounded-[3px] text-[8px] font-extrabold leading-4 tracking-wide transition-colors duration-100 ${
          driver.brake ? "bg-red-600 text-white" : "bg-white/10 text-white/30"
        }`}
      >
        BRAKE
      </span>
      {drsOpen && <span className="px-1 rounded-[3px] bg-green-500 text-black text-[8px] font-extrabold leading-4">DRS</span>}
    </div>
  );
}

function NativeControls({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.controls = true;
    return () => {
      v.controls = false;
    };
  }, [videoRef]);
  return null;
}

function fmtDrift(d: number | null) {
  return d === null ? "not synced" : `${d >= 0 ? "+" : ""}${d.toFixed(2)}s`;
}

function StreamInfo({ label, d, drift }: { label: string; d: StreamDebug; drift: number | null }) {
  return (
    <div className="space-y-0.5">
      <p className="font-bold text-white">{label}</p>
      <p>Stream: {d.playback?.stream_type ?? "?"} · DRM: {d.playback?.drm_type ?? "?"} · entitlement token: {d.playback ? String(d.playback.entitlement_token_used) : "?"}</p>
      <p>Licence ({d.licence.via}): {d.licence.ok}/{d.licence.attempts} ok · last status {d.licence.lastStatus ?? "-"}</p>
      <p>Key system: {d.keySystem ?? "-"} {d.videoRobustness ? `(${d.videoRobustness})` : ""}</p>
      <p>
        Playing: {d.active ? `${d.active.width}×${d.active.height}${d.active.frameRate ? ` @ ${d.active.frameRate}fps` : ""} · ${(d.active.bandwidth / 1e6).toFixed(1)} Mbps` : "-"}
      </p>
      <p>Available heights: {d.availableHeights.length ? d.availableHeights.join(", ") : "-"}</p>
      <p>Dropped frames: {d.droppedFrames}/{d.decodedFrames} · est. bandwidth {(d.estimatedBandwidth / 1e6).toFixed(1)} Mbps</p>
      <p>Drift: {fmtDrift(drift)}</p>
      {d.error && (
        <pre className="whitespace-pre-wrap break-all text-red-300 max-h-32 overflow-y-auto">
          {d.error.message}
          {d.error.data ? `\n${JSON.stringify(d.error.data, null, 1)}` : ""}
        </pre>
      )}
    </div>
  );
}

function DebugPanel({
  opts,
  setOpts,
  main,
  onboard,
  mainDrift,
  onboardDrift,
  content,
}: {
  opts: StreamOptions;
  setOpts: (o: StreamOptions) => void;
  main: StreamDebug;
  onboard: StreamDebug | null;
  mainDrift: number | null;
  onboardDrift: number | null;
  content: F1TVContent | null;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="absolute bottom-3 left-3 w-[380px] max-h-[70%] overflow-y-auto bg-black/85 border border-f1-border rounded-lg p-3 text-[10px] text-f1-muted font-mono space-y-3 z-30">
      <div className="space-y-1">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={opts.licenceViaServer} onChange={(e) => setOpts({ ...opts, licenceViaServer: e.target.checked })} />
          Licence via this server
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={opts.relay} onChange={(e) => setOpts({ ...opts, relay: e.target.checked })} />
          Relay manifest and segments through this server
        </label>
      </div>
      <StreamInfo label="Broadcast" d={main} drift={mainDrift} />
      {onboard && <StreamInfo label="Onboard" d={onboard} drift={onboardDrift} />}
      <button onClick={() => setShowRaw((v) => !v)} className="underline">{showRaw ? "Hide" : "Show"} raw responses</button>
      {showRaw && (
        <pre className="whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
          {JSON.stringify({ content, play: main.playbackRaw }, null, 1)}
        </pre>
      )}
    </div>
  );
}
