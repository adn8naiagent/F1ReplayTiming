"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { f1tv, type F1TVChannel, type F1TVContent } from "@/lib/f1tv";
import type { RCMessage, ReplayDriver } from "@/hooks/useReplaySocket";
import { useF1TVStream, type StreamDebug, type StreamOptions } from "@/hooks/useF1TVStream";
import { useReplayClock, useVideoSync } from "@/hooks/useVideoSync";

interface Props {
  /** e.g. "2026_14_R" — keys the saved F1 TV link and sync offsets. */
  sessionKey: string;
  timestamp: number | undefined;
  playing: boolean;
  speed: number;
  /** Settings > Broadcast: the view to open in (multi-view: broadcast,
   *  onboards and map side by side; otherwise the map over the broadcast),
   *  onboard telemetry, and the map. The hover controls flip these for now
   *  without changing the settings. */
  multiView: boolean;
  onMultiViewChange: (multiView: boolean) => void;
  showTelemetry: boolean;
  showMap: boolean;
  onToggleMap: () => void;
  /** The track map, beside the onboards or over the broadcast. */
  trackOverlay: React.ReactNode;
  /** Drivers in the current frame by racing number, for the onboard's telemetry */
  driversByNumber: Record<string, ReplayDriver>;
  /** The latest race control message, when race control is on */
  raceControl?: RCMessage | null;
  /** Race control and team radio switches in the hover controls */
  raceControlOn: boolean;
  onToggleRaceControl: () => void;
  teamRadioOn: boolean;
  onToggleTeamRadio: () => void;
  /** The radio clips' own audio: separate, since the broadcast often plays
   *  the same message (Settings > Team Radio > Mute audio) */
  radioAudioOn: boolean;
  onToggleRadioAudio: () => void;
  /** Controls shown without hover (after a tap on a touch screen) */
  controlsShown: boolean;
  /** The broadcast's sound (onboards are always muted) */
  muted?: boolean;
  /** 0–1 */
  volume?: number;
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

// F1 TV's names for its other feeds (which ones there are depends on the
// account and the session)
const FEED_NAMES: Record<string, string> = {
  "F1 LIVE": "F1 Live",
  "INTERNATIONAL": "International",
  "TRACKER": "Driver Tracker",
  "DATA": "Data Channel",
  "PIT LANE": "Pit Lane Channel",
};

function feedName(c: F1TVChannel): string {
  const title = (c.title || "").trim();
  return FEED_NAMES[title.toUpperCase()] ?? title.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isOnboard(c: F1TVChannel) {
  return (c.type || "").toLowerCase() === "obc" || c.driver_number != null;
}

// How far F1 TV's real-time stamp runs ahead of the pictures (measured
// against the engine-sound match)
const STAMP_DELAY_S = 7.7;

// Multi-view's onboard choices for sessions opened on this page, so they
// survive switching to the track map and back, but not opening a session
const onboardsThisPage = new Map<string, [string | null, string | null]>();

// Multi-view's side panel, as a share of the width
const SIDE_MAX = 0.3;
const SIDE_MIN = 0.16;

export default function BroadcastView({ sessionKey, timestamp, playing, speed, multiView, onMultiViewChange, showTelemetry, showMap, onToggleMap: toggleMap, trackOverlay, driversByNumber, raceControl, raceControlOn, onToggleRaceControl, teamRadioOn, onToggleTeamRadio, radioAudioOn, onToggleRadioAudio, controlsShown, muted = false, volume = 1 }: Props) {
  const linkKey = `f1tv_content_${sessionKey}`;
  const [link, setLink] = useState<string>(() => readJson(linkKey, ""));
  const [linkDraft, setLinkDraft] = useState("");
  // Finding this session on F1 TV automatically; the link box is the fallback
  const [finding, setFinding] = useState<"searching" | "not_found" | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [content, setContent] = useState<F1TVContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const [opts, setOpts] = useState<StreamOptions>(() => readJson("f1tv_stream_opts", { licenceViaServer: true, relay: false }));
  const [mainChannel, setMainChannel] = useState<string | null>(null);
  // Telemetry on each onboard, switched one at a time (Settings > Broadcast
  // sets both)
  // (remembered; changing the setting resets both)
  const [telemetryOn, setTelemetryOnState] = useState<[boolean, boolean]>(() =>
    readJson("f1tv_onboard_telemetry", [showTelemetry, showTelemetry]),
  );
  const setTelemetryOn = (update: (v: [boolean, boolean]) => [boolean, boolean]) =>
    setTelemetryOnState((v) => { const next = update(v); writeJson("f1tv_onboard_telemetry", next); return next; });
  const telemetrySetting = useRef(showTelemetry);
  useEffect(() => {
    if (telemetrySetting.current === showTelemetry) return; // not on first load
    telemetrySetting.current = showTelemetry;
    setTelemetryOn(() => [showTelemetry, showTelemetry]);
  }, [showTelemetry]); // eslint-disable-line react-hooks/exhaustive-deps
  // Multi-view's two onboards. Every session opens with none; switching to
  // the track map and back keeps them.
  const [onboardDrivers, setOnboardDriversState] = useState<[string | null, string | null]>(
    () => onboardsThisPage.get(sessionKey) ?? [null, null],
  );
  const setOnboardDriver = (slot: 0 | 1, number: string | null) => {
    setOnboardDriversState((prev) => {
      const next: [string | null, string | null] = [...prev];
      next[slot] = number;
      // Closing the first moves the second up
      if (!next[0] && next[1]) next.reverse();
      onboardsThisPage.set(sessionKey, next);
      return next;
    });
  };
  const [showDebug, setShowDebug] = useState(false);

  const mainRef = useRef<HTMLVideoElement>(null);
  const main = useF1TVStream(mainRef);

  // Sync. The broadcast follows the replay: video time = replay time + offset.
  // The server matches the onboards' engine sound to the timing's RPM for
  // the offset. Where it can't (encrypted audio), the video's real-time
  // stamp is used, which runs a few seconds early; a manual Sync is the
  // last resort. Nudges are remembered per session. The onboards follow
  // the broadcast (F1 TV's feeds share one timeline), with their own nudge.
  // (v2: manual syncs made before they could override the automatic one are dropped)
  const offsetKey = (channel: string | null) => `f1tv_offset2_${sessionKey}_${content?.content_id}_${channel ?? "main"}`;
  // (v2: nudges made against the earlier, less accurate sync are dropped)
  const nudgeKey = (which: "main" | "onboard") => `f1tv_nudge2_${sessionKey}_${which}`;
  const [manualOffset, setManualOffset] = useState<number | null>(null);
  // Lining up by hand: the video plays freely with its own controls until
  // Set sync here
  const [aligning, setAligning] = useState(false);
  const [mainNudge, setMainNudge] = useState<number>(() => readJson(nudgeKey("main"), 0));
  const [onboardNudge, setOnboardNudge] = useState<number>(() => readJson(nudgeKey("onboard"), 0));
  const [replayStart, setReplayStart] = useState<number | null>(null);
  const [replayStartChecked, setReplayStartChecked] = useState(false);
  useEffect(() => {
    const [year, round, type] = sessionKey.split("_");
    setReplayStartChecked(false);
    f1tv.replayStart(Number(year), Number(round), type)
      .then((r) => setReplayStart(r.replay_start_utc))
      .catch(() => setReplayStart(null))
      .finally(() => setReplayStartChecked(true));
  }, [sessionKey]);
  const [soundSync, setSoundSync] = useState<{ offset: number; content_id: string; drivers?: string[] } | null>(null);
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
  // A manual sync wins over the automatic one until it's cleared
  const mainOffset = aligning ? null : manualOffset ?? (autoOffset !== null ? autoOffset + mainNudge : null);
  // Lining up by hand is offered only when asked for, or once both automatic
  // ways have failed; never while the automatic sync is still working, when
  // playing the video by itself would just put it out of step
  const autoFailed =
    !syncing && replayStartChecked && main.state === "ready" && autoOffset === null && manualOffset === null;
  const manualControls = aligning || autoFailed;
  // How this session is synced, for the hover controls
  const soundSynced = !!soundSync && link.includes(soundSync.content_id);
  const syncMethod: { label: string; hint: string; tone: "good" | "rough" | "busy" } | null = aligning
    ? { label: "Syncing manually…", hint: "Find the moment in the broadcast that matches the timing, then press Set sync here.", tone: "busy" }
    : manualOffset !== null
    ? { label: "Synced manually", hint: "Lined up with Sync manually. Clear it to go back to the automatic sync.", tone: "rough" }
    : soundSynced
    ? {
        label: `Synced by engine sound${soundSync!.drivers?.length ? ` (${soundSync!.drivers.join(", ")})` : ""}`,
        hint: "Lined up by matching onboard engine sound to the drivers' revs in the timing. Accurate to a fraction of a second.",
        tone: "good",
      }
    : syncing
      ? {
          label: "Lining up with the timing…",
          hint: "Matching onboard engine sound to the timing. The first time for a session takes about a minute.",
          tone: "busy",
        }
      : autoOffset !== null
        ? {
            label: "Synced by video time stamp (approximate)",
            hint: "F1 TV's audio for this session is protected, so the engine sound couldn't be matched. Lined up from the time stamp in F1 TV's video instead, usually within a second or two. Adjust with the buttons if needed.",
            tone: "rough",
          }
        : null;

  const clock = useReplayClock(timestamp, playing, speed);
  const mainDrift = useVideoSync(mainRef, main.state === "ready", clock, playing, speed, mainOffset);
  const broadcastClock = useCallback(() => mainRef.current?.currentTime ?? 0, []);
  const broadcastPlaying = mainOffset !== null ? playing : !!mainRef.current && !mainRef.current.paused;

  useEffect(() => writeJson("f1tv_stream_opts", opts), [opts]);
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.muted = muted;
      mainRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, [muted, volume, main.state]);

  // No saved link: find this session's replay on F1 TV.
  useEffect(() => {
    if (link) return;
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
  }, [link, sessionKey, linkKey]);

  // Look up the feeds for the saved link.
  useEffect(() => {
    if (!link) return;
    setContentError(null);
    f1tv.content(link).then(setContent).catch((e) => {
      setContent(null);
      setContentError(e.message);
    });
  }, [link]);

  const mainFeeds = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && !isOnboard(c)), [content]);
  const onboards = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && isOnboard(c) && c.driver_number), [content]);
  // A side slot holds a driver's number (their onboard)
  const channelOf = (value: string | null) => {
    if (!value) return null;
    return onboards.find((c) => String(c.driver_number) === value)?.channel_id ?? null;
  };
  const sideColumn = multiView;
  // Multi-view's side panel, as a share of the width: drag its edge to make
  // it narrower (never wider than the default). Remembered.
  const [sideShare, setSideShareState] = useState<number>(() => readJson("f1tv_side_share", SIDE_MAX));
  const rootRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const moveResize = (e: React.PointerEvent) => {
    if (!resizing || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setSideShareState(Math.max(SIDE_MIN, Math.min(SIDE_MAX, (rect.right - e.clientX) / rect.width)));
  };
  const endResize = () => {
    if (!resizing) return;
    setResizing(false);
    setSideShareState((v) => { writeJson("f1tv_side_share", v); return v; });
  };
  const mainWidth = sideColumn ? `${(1 - sideShare) * 100}%` : "100%";
  const shownOnboards = sideColumn
    ? onboardDrivers.filter((n): n is string => !!channelOf(n))
    : [];

  // (Re)load the main feed.
  useEffect(() => {
    if (!link || !content) return;
    setManualOffset(readJson<number | null>(offsetKey(mainChannel), null));
    void main.load(link, mainChannel, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, content, mainChannel, opts]);

  // Manual sync: pause both, let the video be scrubbed to the moment that
  // matches the timing, then record the gap
  const startManualSync = () => {
    setAligning(true);
    mainRef.current?.pause();
  };
  const syncHere = useCallback(() => {
    const video = mainRef.current;
    if (!video) return;
    const offset = video.currentTime - clock();
    setManualOffset(offset);
    writeJson(offsetKey(mainChannel), offset);
    setAligning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, mainChannel, content]);

  const nudge = (which: "main" | "onboard", by: number) => {
    if (which === "onboard") {
      const next = onboardNudge + by;
      setOnboardNudge(next);
      writeJson(nudgeKey("onboard"), next);
    } else if (manualOffset !== null) {
      setManualOffset(manualOffset + by);
      writeJson(offsetKey(mainChannel), manualOffset + by);
    } else if (autoOffset !== null) {
      const next = mainNudge + by;
      setMainNudge(next);
      writeJson(nudgeKey("main"), next);
    }
  };

  const resetSync = (which: "main" | "onboard") => {
    if (which === "onboard") {
      setOnboardNudge(0);
      writeJson(nudgeKey("onboard"), 0);
    } else if (manualOffset !== null) {
      setManualOffset(null);
      writeJson(offsetKey(mainChannel), null);
    } else {
      setMainNudge(0);
      writeJson(nudgeKey("main"), 0);
    }
  };

  // M shows or hides the track map; Shift+D the stream details.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "D") setShowDebug((v) => !v); // stream details, for troubleshooting
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
          {finding === "not_found" && (
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
    <div ref={rootRef} className="relative w-full h-full bg-black overflow-hidden group">
      {/* Protected video can be drawn in its own hardware layer that ignores
          stacking, so nothing overlaps it: in multi-view the broadcast takes
          the left, and the onboards and map a column on the right. */}
      <video
        ref={mainRef}
        className="absolute inset-y-0 left-0 h-full object-contain"
        style={{ width: mainWidth }}
        playsInline
      />

      {main.state !== "ready" && (
        <div className="absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-3 px-6" style={{ width: mainWidth }}>
          <p className={`text-xs text-center max-w-md leading-relaxed ${contentError || main.state === "error" ? "text-white/80" : "text-f1-muted"}`}>
            {contentError || (main.state === "error" ? main.debug.error?.message : "Loading broadcast…")}
          </p>
          {main.state === "error" && link && (
            <button
              onClick={() => void main.load(link, mainChannel, opts)}
              className="px-3 py-1 rounded bg-f1-border text-white text-xs font-bold hover:bg-f1-red transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {raceControl && (
        <div className="absolute bottom-3 left-0 z-20 flex justify-center pointer-events-none" style={{ width: mainWidth }}>
          <RaceControlTicker message={raceControl} />
        </div>
      )}

      {/* Multi-view's column: up to two onboards, one under the other, then
          the map. Starts below the page's hover buttons (Track map /
          Broadcast, RC) so they never cover an onboard's ×. */}
      {sideColumn ? (
        <>
        {/* Drag the panel's edge to make it narrower: shown on hover, or
            after a tap on touch screens */}
        <div
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={`absolute top-12 bottom-3 z-30 w-4 -ml-2 flex items-center justify-center cursor-col-resize touch-none transition-opacity ${
            resizing || controlsShown ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:pointer-events-none"
          }`}
          style={{ left: mainWidth }}
          title="Drag to make the side panel narrower"
          role="separator"
          aria-orientation="vertical"
        >
          <div className={`w-1 h-16 rounded-full ${resizing ? "bg-white" : "bg-white/50"}`} />
        </div>
        <div
          className="absolute top-12 bottom-3 right-3 z-20 flex flex-col gap-2 [container-type:inline-size]"
          style={{ width: `calc(${sideShare * 100}% - 1.5rem)` }}
        >
          {([0, 1] as const).map((slot) => {
            const number = onboardDrivers[slot];
            const channel = channelOf(number);
            const picker = (
              <OnboardPicker
                onboards={onboards}
                driversByNumber={driversByNumber}
                value={number}
                exclude={onboardDrivers[slot === 0 ? 1 : 0]}
                placeholder={slot === 0 ? "Choose an onboard" : "Add a second onboard"}
                onChange={(n) => setOnboardDriver(slot, n)}
              />
            );
            if (channel && number) {
              return (
                <OnboardPane
                  key={`${slot}-${channel}`}
                  link={link}
                  channel={channel}
                  opts={opts}
                  mainRef={mainRef}
                  mainReady={main.state === "ready"}
                  playing={broadcastPlaying}
                  speed={mainOffset !== null ? speed : 1}
                  replaySpeed={speed}
                  nudge={onboardNudge}
                  driver={driversByNumber[number]}
                  showTelemetry={telemetryOn[slot]}
                  onToggleTelemetry={() => setTelemetryOn((v) => (slot === 0 ? [!v[0], v[1]] : [v[0], !v[1]]))}
                  picker={picker}
                  controlsShown={controlsShown}
                  onClose={() => setOnboardDriver(slot, null)}
                />
              );
            }
            // An empty first slot is a placeholder the size of an onboard;
            // the second, just its picker
            if (slot === 1) return channelOf(onboardDrivers[0]) ? <div key={slot} className="flex-shrink-0">{picker}</div> : null;
            return (
              <OnboardBox key={slot}>
                <div className="w-full h-full rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center gap-2">
                  <span className="text-[10px] text-white/50">{onboards.length ? "Onboard camera" : "No onboards for this session"}</span>
                  {onboards.length > 0 && picker}
                </div>
              </OnboardBox>
            );
          })}
          {showMap && (
            // A fixed height, so it stays readable (the onboards scale around
            // it), and the column's full width, so wide tracks fill it too,
            // with a margin so corner numbers aren't cut off
            <div className="flex-shrink-0 h-[clamp(170px,38%,300px)] px-4 py-3 pointer-events-none [&_.bg-f1-dark]:!bg-transparent">
              {trackOverlay}
            </div>
          )}
        </div>
        </>
      ) : showMap && (
        // Just the track lines over the video: the map's own background is
        // made transparent here
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-[26%] max-w-[340px] aspect-square pointer-events-none [&_.bg-f1-dark]:!bg-transparent">
          {trackOverlay}
        </div>
      )}

      {/* Controls */}
      {/* Shown on hover, or for a few seconds after a tap on touch screens
          (where hidden controls mustn't catch taps) */}
      <div className={`absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5 transition-opacity ${
        controlsShown ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:pointer-events-none"
      }`}>
        <div className="flex items-center gap-1.5">
          {/* Flips the view for now; Settings > Broadcast sets the default */}
          <div className="flex rounded border border-f1-border overflow-hidden">
            {([[true, "Multi-view"], [false, "Single view"]] as const).map(([value, label]) => (
              <button
                key={label}
                onClick={() => onMultiViewChange(value)}
                className={`px-2 py-1 text-[10px] font-bold transition-colors ${
                  multiView === value ? "bg-white text-black" : "bg-f1-card/90 text-f1-muted hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mainFeeds.length > 0 && (
            <select value={mainChannel ?? ""} onChange={(e) => setMainChannel(e.target.value || null)} className={selectClass}>
              <option value="">Main feed</option>
              {mainFeeds.map((c) => (
                <option key={c.channel_id!} value={c.channel_id!}>{feedName(c)}</option>
              ))}
            </select>
          )}
        </div>
        {/* How it's synced, with Sync manually beside it (or, while lining
            up by hand, Set sync here and Cancel) */}
        <div className="flex items-center gap-1.5">
          {syncMethod && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/80 border border-f1-border text-[10px] text-white/80" title={syncMethod.hint}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                syncMethod.tone === "good" ? "bg-green-400" : syncMethod.tone === "busy" ? "bg-white/50 animate-pulse" : "bg-amber-400"
              }`} />
              {syncMethod.label}
            </div>
          )}
          {manualControls ? (
            <>
              <button onClick={syncHere} className={`${btnClass} !text-white !bg-f1-red border-f1-red`} title="Line the video up with the timing, then press">
                Set sync here
              </button>
              {aligning && <button onClick={() => setAligning(false)} className={btnClass}>Cancel</button>}
            </>
          ) : mainOffset !== null && (
            <button onClick={startManualSync} className={btnClass} title="Line the broadcast up with the timing yourself">
              Sync manually
            </button>
          )}
        </div>
        {/* Fine-tune: nudge the video against the timing */}
        {!manualControls && mainOffset !== null && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 border border-f1-border">
            <span className="text-[9px] font-bold text-f1-muted uppercase tracking-wider mr-0.5">Fine-tune video sync</span>
            <button onClick={() => nudge("main", -5)} className={btnClass} title="Video earlier against the timing">−5s</button>
            <button onClick={() => nudge("main", -0.5)} className={btnClass} title="Video earlier against the timing">−0.5s</button>
            <button onClick={() => nudge("main", 0.5)} className={btnClass} title="Video later against the timing">+0.5s</button>
            <button onClick={() => nudge("main", 5)} className={btnClass} title="Video later against the timing">+5s</button>
            {/* The adjustment made, or the manual sync; × goes back to the automatic sync */}
            {manualOffset !== null ? (
              <button onClick={() => resetSync("main")} className={`${btnClass} !text-white`} title="Clear the manual sync">
                Manual ×
              </button>
            ) : mainNudge !== 0 && (
              <button onClick={() => resetSync("main")} className={`${btnClass} !text-white tabular-nums`} title="Back to the automatic sync">
                {mainNudge > 0 ? "+" : ""}{mainNudge}s ×
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {([
            ["Track map", showMap, toggleMap, "Shortcut: M"],
            ["Race control", raceControlOn, onToggleRaceControl, "The latest message, along the bottom"],
            ["Team radio", teamRadioOn, onToggleTeamRadio, "Radio messages with captions, at the top"],
            ...(teamRadioOn
              ? ([["Radio audio", radioAudioOn, onToggleRadioAudio, "Play each radio message's audio. The broadcast often plays it too, so you may hear it twice"]] as const)
              : []),
          ] as const).map(([label, on, toggle, title]) => (
            <button
              key={label}
              onClick={toggle}
              title={title}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold backdrop-blur-sm transition-colors ${
                on ? "bg-black/80 border-white/40 text-white" : "bg-black/80 border-f1-border text-white/60 hover:text-white"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-green-400" : "bg-white/25"}`} />
              {label}
            </button>
          ))}
        </div>
        {manualControls && (
          <p className="text-[10px] text-white/80 bg-black/60 rounded px-2 py-1 max-w-[280px]">
            {aligning ? "" : "This session couldn't be synced automatically. "}Use the video controls to find the moment that matches the timing (lights out or a car crossing the line works well), then press Set sync here.
          </p>
        )}
      </div>

      {/* Unsynced videos need their own controls to line them up. */}
      {manualControls && main.state === "ready" && <NativeControls videoRef={mainRef} />}

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

/** The latest race control message over the broadcast: one line that
 *  appears when a message arrives and fades after a few seconds, so it
 *  doesn't sit over the pictures. */
function RaceControlTicker({ message }: { message: RCMessage }) {
  const key = `${message.timestamp}|${message.message}`;
  const [visible, setVisible] = useState(false);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    // The message already showing when race control is turned on, too
    if (seen.current === key) return;
    seen.current = key;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [key]);
  const upper = message.message.toUpperCase();
  const dot = upper.includes("PENALTY") && !upper.includes("NO FURTHER")
    ? "bg-red-500"
    : upper.includes("INVESTIGATION") || upper.includes("NOTED")
      ? "bg-orange-400"
      : upper.includes("NO FURTHER") || upper.includes("NO INVESTIGATION")
        ? "bg-green-500"
        : upper.includes("YELLOW") || upper.includes("SAFETY CAR")
          ? "bg-yellow-400"
          : "bg-white/50";
  return (
    <div
      className={`flex items-center gap-2 max-w-[min(40rem,calc(100%-1.5rem))] px-3 py-1.5 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 transition-opacity duration-700 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-[9px] font-bold text-orange-300 uppercase tracking-wider flex-shrink-0">Race control</span>
      <span className="text-[11px] text-white truncate">{message.message}</span>
    </div>
  );
}

/** One onboard camera, following the broadcast's position. */
function OnboardPane({ link, channel, opts, mainRef, mainReady, playing, speed, replaySpeed, nudge, driver, showTelemetry, onToggleTelemetry, picker, controlsShown, onClose }: {
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
  showTelemetry: boolean;
  /** Shows or hides this onboard's telemetry for now (Settings > Broadcast sets the default) */
  onToggleTelemetry: () => void;
  /** Switches this onboard to another driver (on hover) */
  picker: React.ReactNode;
  controlsShown: boolean;
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
    <OnboardBox>
      <div className="relative w-full h-full group/pane">
      {/* The picker sits outside the rounded frame so its menu isn't cut off */}
      <div className={`absolute top-1.5 left-1.5 z-30 transition-opacity ${controlsShown ? "opacity-100" : "opacity-0 group-hover/pane:opacity-100 focus-within:opacity-100 [@media(hover:none)]:pointer-events-none"}`}>{picker}</div>
      <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-white/10">
        <video ref={ref} className="w-full h-full object-contain" muted playsInline />
        {driver && (
          <button
            onClick={onToggleTelemetry}
            className={`absolute top-1.5 right-9 h-6 px-2 rounded-full bg-black/70 text-[10px] font-bold flex items-center gap-1 transition-opacity ${
              showTelemetry ? "text-white" : "text-white/60 hover:text-white"
            } ${controlsShown ? "opacity-100" : "opacity-0 group-hover/pane:opacity-100 [@media(hover:none)]:pointer-events-none"}`}
            title={showTelemetry ? "Hide telemetry on this onboard" : "Show telemetry on this onboard"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${showTelemetry ? "bg-green-400" : "bg-white/30"}`} />
            Telemetry
          </button>
        )}
        <button
          onClick={onClose}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:text-white text-sm leading-none flex items-center justify-center"
          title="Close this onboard"
          aria-label="Close onboard"
        >
          ×
        </button>
        {showTelemetry && <OnboardTelemetry driver={driver} speed={replaySpeed} />}
        {stream.state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
            <p className="text-[10px] text-white/80 leading-snug">{stream.debug.error?.message}</p>
            <button
              onClick={() => void stream.load(link, channel, opts)}
              className="px-2 py-0.5 rounded bg-f1-border text-white text-[10px] font-bold hover:bg-f1-red transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
      </div>
    </OnboardBox>
  );
}

/** An onboard's space in the column: 16:9 at the column's width, shrinking
 *  (still 16:9) when two onboards and the map don't fit. */
function OnboardBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex justify-center [container-type:size]" style={{ maxHeight: "calc(100cqw * 9 / 16)" }}>
      <div className="aspect-video" style={{ width: "min(100cqw, 100cqh * 16 / 9)" }}>{children}</div>
    </div>
  );
}

/** Choose a side slot's driver onboard (styled like Lap Analysis's driver
 *  menus). Drivers are in running order; ones not in the timing still show,
 *  from F1 TV's list. */
function OnboardPicker({ onboards, driversByNumber, value, exclude, placeholder, onChange }: {
  onboards: F1TVChannel[];
  driversByNumber: Record<string, ReplayDriver>;
  value: string | null;
  exclude: string | null;
  placeholder: string;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const drivers = onboards
    .map((c) => {
      const n = String(c.driver_number);
      const d = driversByNumber[n];
      return {
        value: n,
        abbr: d?.abbr ?? c.driver_name?.split(" ").pop()?.slice(0, 3).toUpperCase() ?? n,
        team: d?.team ?? c.team ?? "",
        color: d?.color ?? (c.color ? (c.color.startsWith("#") ? c.color : `#${c.color}`) : "#888"),
        position: d?.position ?? 99,
        number: Number(n),
      };
    })
    .filter((d) => d.value !== exclude)
    .sort((a, b) => a.position - b.position || a.number - b.number);

  const selectedDriver = drivers.find((d) => d.value === value);
  const pick = (v: string | null) => { onChange(v); setOpen(false); };
  const row = "w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors text-left";

  return (
    <div ref={ref} className="relative w-44 pointer-events-auto">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-left hover:border-f1-muted transition-colors"
      >
        {selectedDriver ? (
          <>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selectedDriver.color }} />
            <span className="text-xs font-bold text-white">{selectedDriver.abbr}</span>
            <span className="text-[10px] text-f1-muted truncate">{selectedDriver.team}</span>
          </>
        ) : (
          <span className="text-xs text-f1-muted">{placeholder}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-f1-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-f1-dark border border-f1-border rounded shadow-xl z-50 max-h-[260px] overflow-y-auto">
          {value && (
            <button onClick={() => pick(null)} className={`${row} text-xs text-f1-muted`}>Clear</button>
          )}
          {drivers.length > 0 && (
            <>
              {drivers.map((d) => (
                <button key={d.value} onClick={() => pick(d.value)} className={`${row} ${d.value === value ? "bg-white/10" : ""}`}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-[10px] font-bold text-f1-muted w-4 text-right">{d.position < 99 ? d.position : ""}</span>
                  <span className="text-xs font-bold text-white">{d.abbr}</span>
                  <span className="text-[10px] text-f1-muted truncate">{d.team}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
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
