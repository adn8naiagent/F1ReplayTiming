"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { f1tv, type F1TVChannel, type F1TVContent } from "@/lib/f1tv";
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

export default function BroadcastView({ sessionKey, timestamp, playing, speed, selectedDriverNumbers, trackOverlay }: Props) {
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
  const [showOnboard, setShowOnboard] = useState(true);
  const [showOverlays, setShowOverlays] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  const mainRef = useRef<HTMLVideoElement>(null);
  const onboardRef = useRef<HTMLVideoElement>(null);
  const main = useF1TVStream(mainRef);
  const onboard = useF1TVStream(onboardRef);

  const offsetKey = (channel: string | null) => `f1tv_offset_${sessionKey}_${content?.content_id}_${channel ?? "main"}`;
  const [mainOffset, setMainOffset] = useState<number | null>(null);
  const [onboardOffset, setOnboardOffset] = useState<number | null>(null);

  const clock = useReplayClock(timestamp, playing, speed);
  const mainDrift = useVideoSync(mainRef, main.state === "ready", clock, playing, speed, mainOffset);
  const onboardDrift = useVideoSync(onboardRef, onboard.state === "ready", clock, playing, speed, onboardOffset);

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
    setMainOffset(readJson<number | null>(offsetKey(mainChannel), null));
    void main.load(link, mainChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, mainChannel, opts]);

  // (Re)load the onboard.
  useEffect(() => {
    if (!link || !content || !onboardChannel || !showOnboard) {
      void onboard.unload();
      return;
    }
    setOnboardOffset(readJson<number | null>(offsetKey(onboardChannel), null));
    void onboard.load(link, onboardChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, onboardChannel, showOnboard, opts]);

  const syncHere = useCallback(
    (which: "main" | "onboard") => {
      const video = (which === "main" ? mainRef : onboardRef).current;
      if (!video) return;
      const offset = video.currentTime - clock();
      if (which === "main") {
        setMainOffset(offset);
        writeJson(offsetKey(mainChannel), offset);
      } else {
        setOnboardOffset(offset);
        writeJson(offsetKey(onboardChannel), offset);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clock, mainChannel, onboardChannel, content],
  );

  const nudge = (which: "main" | "onboard", by: number) => {
    if (which === "main" && mainOffset !== null) {
      setMainOffset(mainOffset + by);
      writeJson(offsetKey(mainChannel), mainOffset + by);
    }
    if (which === "onboard" && onboardOffset !== null) {
      setOnboardOffset(onboardOffset + by);
      writeJson(offsetKey(onboardChannel), onboardOffset + by);
    }
  };

  const unsync = (which: "main" | "onboard") => {
    if (which === "main") {
      setMainOffset(null);
      writeJson(offsetKey(mainChannel), null);
    } else {
      setOnboardOffset(null);
      writeJson(offsetKey(onboardChannel), null);
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
      <video ref={mainRef} className="w-full h-full object-contain" playsInline />

      {main.state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-f1-muted">
            {contentError || (main.state === "error" ? main.debug.error?.message : "Loading broadcast…")}
          </p>
        </div>
      )}

      {showOverlays && (
        <div className="absolute top-3 left-3 w-[26%] max-w-[340px] aspect-square bg-black/55 rounded-lg overflow-hidden border border-white/10">
          {trackOverlay}
        </div>
      )}

      {/* Kept mounted while hidden so the player stays attached. */}
      {showOnboard && onboardChannel && (
        <div className={`absolute bottom-3 right-3 w-[28%] max-w-[420px] aspect-video bg-black rounded-lg overflow-hidden border border-white/10 ${showOverlays ? "" : "hidden"}`}>
          <video ref={onboardRef} className="w-full h-full object-contain" muted playsInline controls={onboardOffset === null && onboard.state === "ready"} />
          {onboard.state === "error" && (
            <p className="absolute inset-0 flex items-center justify-center text-[10px] text-f1-muted p-2 text-center">
              {onboard.debug.error?.message}
            </p>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-12 right-3 z-20 flex flex-col items-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
            <button onClick={() => syncHere("main")} className={`${btnClass} !text-white !bg-f1-red border-f1-red`} title="Line the video up with the timing, then press">
              Sync broadcast here
            </button>
          ) : (
            <>
              <button onClick={() => nudge("main", -0.5)} className={btnClass}>−0.5s</button>
              <button onClick={() => nudge("main", 0.5)} className={btnClass}>+0.5s</button>
              <button onClick={() => unsync("main")} className={btnClass}>Re-sync</button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select value={onboardChannel ?? ""} onChange={(e) => setOnboardChannel(e.target.value || null)} className={selectClass}>
            <option value="">No onboard</option>
            {onboards.map((c) => (
              <option key={c.channel_id!} value={c.channel_id!}>
                {c.driver_number ? `${c.driver_number} ` : ""}{c.driver_name || c.title}
              </option>
            ))}
          </select>
          {onboardChannel && (onboardOffset === null ? (
            <button onClick={() => syncHere("onboard")} className={`${btnClass} !text-white !bg-f1-red border-f1-red`}>
              Sync onboard here
            </button>
          ) : (
            <>
              <button onClick={() => nudge("onboard", -0.5)} className={btnClass}>−0.5s</button>
              <button onClick={() => nudge("onboard", 0.5)} className={btnClass}>+0.5s</button>
              <button onClick={() => unsync("onboard")} className={btnClass}>Re-sync</button>
            </>
          ))}
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
        {(mainOffset === null || (onboardChannel && onboardOffset === null)) && (
          <p className="text-[10px] text-white/80 bg-black/60 rounded px-2 py-1 max-w-[280px] text-right">
            Until synced, use the video controls to find the moment that matches the timing (lights out works well), then press Sync.
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
