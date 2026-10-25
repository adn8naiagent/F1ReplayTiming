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

export default function BroadcastView({ sessionKey, timestamp, playing, speed, selectedDriverNumbers, trackOverlay, driversByNumber }: Props) {
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
  const [onboardChannel, setOnboardChannel] = useState<string | null>(null);
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
  const [showDebug, setShowDebug] = useState(false);

  const mainRef = useRef<HTMLVideoElement>(null);
  const onboardRef = useRef<HTMLVideoElement>(null);
  const main = useF1TVStream(mainRef);
  const onboard = useF1TVStream(onboardRef);

  // Sync. The broadcast follows the replay: video time = replay time + offset.
  // Both carry real (UTC) times, so the offset is worked out automatically;
  // a manual Sync is the fallback for sessions without them. ±0.5s nudges
  // are remembered per session. The onboard follows the broadcast (F1 TV's
  // feeds share one clock), with its own nudge.
  const offsetKey = (channel: string | null) => `f1tv_offset_${sessionKey}_${content?.content_id}_${channel ?? "main"}`;
  const nudgeKey = (which: "main" | "onboard") => `f1tv_nudge_${sessionKey}_${which}`;
  const [manualOffset, setManualOffset] = useState<number | null>(null);
  const [mainNudge, setMainNudge] = useState<number>(() => readJson(nudgeKey("main"), 0));
  const [onboardNudge, setOnboardNudge] = useState<number>(() => readJson(nudgeKey("onboard"), 0));
  const [replayStart, setReplayStart] = useState<number | null>(null);
  useEffect(() => {
    const [year, round, type] = sessionKey.split("_");
    f1tv.replayStart(Number(year), Number(round), type).then((r) => setReplayStart(r.replay_start_utc)).catch(() => setReplayStart(null));
  }, [sessionKey]);
  const videoStart = main.debug.playback?.video_start_utc ?? null;
  const autoOffset = replayStart !== null && videoStart !== null ? replayStart - videoStart : null;
  const mainOffset = autoOffset !== null ? autoOffset + mainNudge : manualOffset;

  const clock = useReplayClock(timestamp, playing, speed);
  const mainDrift = useVideoSync(mainRef, main.state === "ready", clock, playing, speed, mainOffset);
  const broadcastClock = useCallback(() => mainRef.current?.currentTime ?? 0, []);
  const broadcastPlaying = mainOffset !== null ? playing : !!mainRef.current && !mainRef.current.paused;
  const onboardDrift = useVideoSync(
    onboardRef, onboard.state === "ready" && main.state === "ready", broadcastClock,
    broadcastPlaying, mainOffset !== null ? speed : 1, onboardNudge,
  );

  useEffect(() => writeJson("f1tv_stream_opts", opts), [opts]);

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
  const onboardVisible = showOnboard && !!onboardChannel && showOverlays;
  const onboardDriverNumber = (() => {
    const c = onboards.find((o) => o.channel_id === onboardChannel);
    return c?.driver_number != null ? String(c.driver_number) : null;
  })();
  const mainFeeds = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && !isOnboard(c)), [content]);

  // Follow the leaderboard selection for the onboard.
  useEffect(() => {
    const match = selectedDriverNumbers
      .map((n) => onboards.find((c) => String(c.driver_number) === n))
      .find(Boolean);
    if (match) setOnboardChannel(match.channel_id);
  }, [selectedDriverNumbers, onboards]);

  // (Re)load the main feed.
  useEffect(() => {
    if (!link || !content) return;
    setManualOffset(readJson<number | null>(offsetKey(mainChannel), null));
    void main.load(link, mainChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, mainChannel, opts]);

  // (Re)load the onboard.
  useEffect(() => {
    if (!link || !content || !onboardChannel || !showOnboard) {
      void onboard.unload();
      return;
    }
    void onboard.load(link, onboardChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, onboardChannel, showOnboard, opts]);

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

      {showOverlays && (
        // Just the track lines over the video: the map's own background is
        // made transparent here
        <div className={`absolute right-3 z-10 aspect-square pointer-events-none [&_.bg-f1-dark]:!bg-transparent ${
          onboardVisible ? "bottom-3 w-[calc(30%-1.5rem)] max-h-[55%]" : "top-1/2 -translate-y-1/2 w-[26%] max-w-[340px]"
        }`}>
          {trackOverlay}
        </div>
      )}

      {/* Kept mounted while hidden so the player stays attached. */}
      {showOnboard && onboardChannel && (
        // Top of the right-hand column, beside the broadcast
        <div className={`absolute top-3 right-3 z-20 w-[calc(30%-1.5rem)] aspect-video bg-black rounded-lg overflow-hidden border border-white/10 ${showOverlays ? "" : "hidden"}`}>
          <video ref={onboardRef} className="w-full h-full object-contain" muted playsInline />
          <button
            onClick={() => setShowOnboard(false)}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:text-white text-sm leading-none flex items-center justify-center"
            title="Hide onboards (turn them back on with Show onboard)"
            aria-label="Hide onboards"
          >
            ×
          </button>
          <OnboardTelemetry driver={onboardDriverNumber ? driversByNumber[onboardDriverNumber] : undefined} />
          {onboard.state === "error" && (
            <p className="absolute inset-0 flex items-center justify-center text-[10px] text-f1-muted p-2 text-center">
              {onboard.debug.error?.message}
            </p>
          )}
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
              <button onClick={() => nudge("main", -0.5)} className={btnClass} title="Video earlier against the timing">−0.5s</button>
              <button onClick={() => nudge("main", 0.5)} className={btnClass} title="Video later against the timing">+0.5s</button>
              <button onClick={() => resetSync("main")} className={btnClass}>{autoOffset !== null ? "Reset sync" : "Re-sync"}</button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={onboardChannel ?? ""}
            onChange={(e) => {
              setOnboardChannel(e.target.value || null);
              // Picking one here is asking to see it, even if onboards were hidden
              if (e.target.value) setShowOnboard(true);
            }}
            className={selectClass}
          >
            <option value="">No onboard</option>
            {onboards.map((c) => (
              <option key={c.channel_id!} value={c.channel_id!}>
                {c.driver_number ? `${c.driver_number} ` : ""}{c.driver_name || c.title}
              </option>
            ))}
          </select>
          {onboardChannel && (
            <>
              <button onClick={() => nudge("onboard", -0.5)} className={btnClass}>−0.5s</button>
              <button onClick={() => nudge("onboard", 0.5)} className={btnClass}>+0.5s</button>
              {onboardNudge !== 0 && <button onClick={() => resetSync("onboard")} className={btnClass}>Reset</button>}
            </>
          )}
          {onboardChannel && (
            <button onClick={() => setShowOnboard((v) => !v)} className={btnClass}>{showOnboard ? "Hide" : "Show"} onboard</button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowOverlays((v) => !v)} className={btnClass} title="Shortcut: H">
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
              void onboard.unload();
            }}
            className={btnClass}
          >
            Change link
          </button>
        </div>
        {mainOffset === null && (
          <p className="text-[10px] text-white/80 bg-black/60 rounded px-2 py-1 max-w-[280px]">
            This session can&apos;t be synced automatically (reprocess it to fix that). Use the video controls to find the moment that matches the timing (lights out works well), then press Sync.
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
          onboard={onboardChannel ? onboard.debug : null}
          mainDrift={mainDrift}
          onboardDrift={onboardDrift}
          content={content}
        />
      )}
    </div>
  );
}

/** Speed, gear, throttle and brake for the onboard's driver, along its bottom edge. */
function OnboardTelemetry({ driver }: { driver?: ReplayDriver }) {
  if (!driver || driver.speed == null) return null;
  const throttle = Math.max(0, Math.min(100, driver.throttle ?? 0));
  return (
    <div className="absolute bottom-0 inset-x-0 flex items-center gap-2 px-2 py-1 bg-gradient-to-t from-black/85 to-black/0 text-[10px] font-bold text-white tabular-nums">
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: driver.color }} />
        {driver.abbr}
      </span>
      <span className="w-14 text-right">{Math.round(driver.speed)} km/h</span>
      <span className="w-6 text-center">{driver.gear ?? "-"}</span>
      <span className="flex-1 h-1.5 rounded bg-white/15 overflow-hidden" title="Throttle">
        <span className="block h-full bg-green-500" style={{ width: `${throttle}%` }} />
      </span>
      <span className={`px-1 rounded ${driver.brake ? "bg-red-600 text-white" : "bg-white/10 text-white/40"}`}>BRK</span>
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
