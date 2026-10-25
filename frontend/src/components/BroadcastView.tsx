"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { f1tv, type F1TVChannel, type F1TVContent } from "@/lib/f1tv";
import type { RCMessage, ReplayDriver } from "@/hooks/useReplaySocket";
import { useF1TVStream, type StreamDebug, type StreamOptions } from "@/hooks/useF1TVStream";
import { useReplayClock, useVideoSync } from "@/hooks/useVideoSync";
import { MINI_HEX, MINI_PIT, miniStatesAt, type MiniSectorData } from "@/lib/miniSectors";

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
  /** Live timing: the broadcast is F1 TV's live stream, which plays at its
   *  own pace; the timing is delayed to match it instead (onDelay, in
   *  seconds, or null when unknown). arrivalLag: how long the timing data
   *  takes to reach the page. */
  live?: { arrivalLag: () => number | null; onDelay: (seconds: number | null) => void } | null;
  /** Mini-sectors (qualifying and practice), for the onboards' sector strip */
  miniSectorData?: MiniSectorData | null;
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

// What a view shows: the broadcast, or a driver's onboard (their number)
type Source = string;
const BROADCAST = "broadcast";
// Multi-view's views: slot 0 is the main view, then up to four more
const SLOT_COUNT = 5;
type Layout = "focus" | "strip" | "pair" | "quad" | "grid";
// How many views each layout shows
const VIEW_COUNT: Record<"single" | Layout, number> = { single: 1, pair: 2, focus: 3, quad: 4, strip: 5, grid: 5 };

// Multi-view's choices for sessions opened on this page, so they survive
// switching to the track map and back, but not opening a session
const slotsThisPage = new Map<string, (Source | null)[]>();

function bySlot(saved: unknown, fallback: boolean): boolean[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) =>
    Array.isArray(saved) && typeof saved[i] === "boolean" ? saved[i] : fallback,
  );
}

type Rect = { x: number; y: number; w: number; h: number };
const place = (r: Rect): React.CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });
// The broadcast when no view shows it: the timing and onboards follow it, so
// it keeps playing, tiny and hidden
const HIDDEN: React.CSSProperties = { left: 0, top: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" };
// Multi-view's spacing: views start below the page's hover buttons
const TOP = 48;
const EDGE = 12;
const GAP = 8;
const PICKER_H = 30;

/** Where each view goes. Single view: the main view fills it. Main + 2: the
 *  main view on the left; a column on the right with two views (16:9 at the
 *  column's width, shrinking when they and the map don't fit), then the map.
 *  Main + 4: the main view across the top; four views and the map in a
 *  strip along the bottom. Side by side: two views, the map below. 2×2: four
 *  views, the map over the middle. Grid: three across and two down, the map
 *  in the bottom-right. Empty slots
 *  get a placeholder with a picker (the column's second, just its picker). */
function layoutViews(mode: "single" | Layout, w: number, h: number, share: number, visible: (Source | null)[], showMap: boolean) {
  const rects: (Rect | null)[] = visible.map(() => null);
  const empty: { slot: number; rect: Rect; compact?: boolean }[] = [];
  let map: Rect | null = null;
  // Main + 4: where the main view ends (race control sits above the strip)
  let mainBottom: number | null = null;
  const put = (slot: number, rect: Rect) => {
    if (visible[slot]) rects[slot] = rect;
    else empty.push({ slot, rect });
  };
  if (mode === "single") {
    put(0, { x: 0, y: 0, w, h });
  } else if (mode === "focus") {
    put(0, { x: 0, y: 0, w: w * (1 - share), h });
    const colX = w * (1 - share) + EDGE;
    const colW = w * share - 2 * EDGE;
    const colH = h - TOP - EDGE;
    const mapH = showMap ? Math.min(300, Math.max(170, colH * 0.38)) : 0;
    const items: { slot: number; picker?: boolean }[] = [{ slot: 1 }];
    if (visible[2]) items.push({ slot: 2 });
    else if (visible[1]) items.push({ slot: 2, picker: true });
    const boxes = items.filter((i) => !i.picker).length;
    const gaps = (items.length - 1 + (showMap ? 1 : 0)) * GAP;
    const boxH = Math.max(0, Math.min((colW * 9) / 16, (colH - mapH - gaps - (items.length - boxes) * PICKER_H) / boxes));
    const boxW = (boxH * 16) / 9;
    let y = TOP;
    for (const item of items) {
      if (item.picker) {
        empty.push({ slot: item.slot, rect: { x: colX, y, w: colW, h: PICKER_H }, compact: true });
        y += PICKER_H + GAP;
      } else {
        put(item.slot, { x: colX + (colW - boxW) / 2, y, w: boxW, h: boxH });
        y += boxH + GAP;
      }
    }
    if (showMap) map = { x: colX, y, w: colW, h: mapH };
  } else if (mode === "strip") {
    const cellW = Math.max(0, (w - 2 * EDGE - 4 * GAP) / 5);
    const cellH = (cellW * 9) / 16;
    const stripY = h - EDGE - cellH;
    mainBottom = stripY - GAP;
    put(0, { x: 0, y: 0, w, h: mainBottom });
    for (let i = 1; i < SLOT_COUNT; i++) put(i, { x: EDGE + (i - 1) * (cellW + GAP), y: stripY, w: cellW, h: cellH });
    if (showMap) map = { x: EDGE + 4 * (cellW + GAP), y: stripY, w: cellW, h: cellH };
  } else if (mode === "pair") {
    // The map keeps at least this much height below
    const mapMin = showMap ? 160 + GAP : 0;
    const tileW = Math.max(0, Math.min((w - 2 * EDGE - GAP) / 2, ((h - TOP - EDGE - mapMin) * 16) / 9));
    const tileH = (tileW * 9) / 16;
    const x = (w - 2 * tileW - GAP) / 2;
    // Centred in the height when there's no map
    const y = showMap ? TOP : TOP + (h - TOP - EDGE - tileH) / 2;
    put(0, { x, y, w: tileW, h: tileH });
    put(1, { x: x + tileW + GAP, y, w: tileW, h: tileH });
    if (showMap) map = { x: EDGE, y: y + tileH + GAP, w: w - 2 * EDGE, h: h - y - tileH - GAP - EDGE };
  } else if (mode === "quad") {
    const tileW = Math.max(0, Math.min((w - 2 * EDGE - GAP) / 2, (((h - TOP - EDGE - GAP) / 2) * 16) / 9));
    const tileH = (tileW * 9) / 16;
    const x = (w - 2 * tileW - GAP) / 2;
    for (let i = 0; i < 4; i++) put(i, { x: x + (i % 2) * (tileW + GAP), y: TOP + Math.floor(i / 2) * (tileH + GAP), w: tileW, h: tileH });
    // Just the track lines, over where the four meet
    const size = tileH * 0.7;
    if (showMap) map = { x: w / 2 - size / 2, y: TOP + tileH + GAP / 2 - size / 2, w: size, h: size };
  } else {
    const cellW = (w - 2 * EDGE - 2 * GAP) / 3;
    const cellH = (h - TOP - EDGE - GAP) / 2;
    const tileW = Math.max(0, Math.min(cellW, (cellH * 16) / 9));
    const tileH = (tileW * 9) / 16;
    const cell = (i: number) => ({ x: EDGE + (i % 3) * (cellW + GAP), y: TOP + Math.floor(i / 3) * (cellH + GAP) });
    for (let i = 0; i < SLOT_COUNT; i++) {
      const c = cell(i);
      put(i, { x: c.x + (cellW - tileW) / 2, y: c.y + (cellH - tileH) / 2, w: tileW, h: tileH });
    }
    if (showMap) map = { ...cell(5), w: cellW, h: cellH };
  }
  return { rects, empty, map, mainBottom };
}

// Multi-view's side panel, as a share of the width
const SIDE_MAX = 0.3;
const SIDE_MIN = 0.16;

export default function BroadcastView({ sessionKey, timestamp, playing, speed, multiView, onMultiViewChange, showTelemetry, showMap, onToggleMap: toggleMap, trackOverlay, driversByNumber, live = null, miniSectorData, raceControl, raceControlOn, onToggleRaceControl, teamRadioOn, onToggleTeamRadio, radioAudioOn, onToggleRadioAudio, controlsShown, muted = false, volume = 1 }: Props) {
  const linkKey = live ? `f1tv_content_live_${sessionKey}` : `f1tv_content_${sessionKey}`;
  const [link, setLink] = useState<string>(() => readJson(linkKey, ""));
  const [linkDraft, setLinkDraft] = useState("");
  // Finding this session on F1 TV automatically; the link box is the fallback
  const [finding, setFinding] = useState<"searching" | "not_found" | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [findAttempt, setFindAttempt] = useState(0);
  const [content, setContent] = useState<F1TVContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const [opts, setOpts] = useState<StreamOptions>(() => readJson("f1tv_stream_opts", { licenceViaServer: true, relay: false }));
  const [mainChannel, setMainChannel] = useState<string | null>(null);
  // Each view's telemetry and mini-sector strip, by slot, switched one at a
  // time (remembered; Settings > Broadcast's telemetry switch resets them)
  const [sectorsOn, setSectorsOn] = useState<boolean[]>(() => bySlot(readJson("f1tv_view_sectors", []), true));
  const toggleSectors = (slot: number) =>
    setSectorsOn((v) => {
      const next = v.map((on, i) => (i === slot ? !on : on));
      writeJson("f1tv_view_sectors", next);
      return next;
    });
  const [telemetryOn, setTelemetryOnState] = useState<boolean[]>(() =>
    bySlot(readJson("f1tv_view_telemetry", []), showTelemetry),
  );
  const setTelemetryOn = (update: (v: boolean[]) => boolean[]) =>
    setTelemetryOnState((v) => { const next = update(v); writeJson("f1tv_view_telemetry", next); return next; });
  const toggleTelemetry = (slot: number) => setTelemetryOn((v) => v.map((on, i) => (i === slot ? !on : on)));
  const telemetrySetting = useRef(showTelemetry);
  useEffect(() => {
    if (telemetrySetting.current === showTelemetry) return; // not on first load
    telemetrySetting.current = showTelemetry;
    setTelemetryOn(() => bySlot([], showTelemetry));
  }, [showTelemetry]); // eslint-disable-line react-hooks/exhaustive-deps
  // What each view shows. Every session opens with just the broadcast, in
  // the main view; switching to the track map and back keeps the choices.
  const [slots, setSlots] = useState<(Source | null)[]>(
    () => slotsThisPage.get(sessionKey) ?? [BROADCAST, null, null, null, null],
  );
  // Puts a source in a slot; one already showing elsewhere swaps places
  const assign = (slot: number, source: Source | null) =>
    setSlots((prev) => {
      const next = [...prev];
      const from = source ? prev.indexOf(source) : -1;
      if (from >= 0) next[from] = prev[slot];
      next[slot] = source;
      slotsThisPage.set(sessionKey, next);
      return next;
    });
  // Multi-view's layout (remembered): a main view with two beside it, or a grid
  const [layout, setLayoutState] = useState<Layout>(() => readJson<Layout>("f1tv_layout", "focus"));
  const setLayout = (value: Layout) => { setLayoutState(value); writeJson("f1tv_layout", value); };
  // The sound follows the main view, unless a view's speaker picked another
  const [audioPick, setAudioPick] = useState<Source | null>(null);
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
    if (live) return;
    const [year, round, type] = sessionKey.split("_");
    setReplayStartChecked(false);
    f1tv.replayStart(Number(year), Number(round), type)
      .then((r) => setReplayStart(r.replay_start_utc))
      .catch(() => setReplayStart(null))
      .finally(() => setReplayStartChecked(true));
  }, [sessionKey, live]);
  const [soundSync, setSoundSync] = useState<{ offset: number; content_id: string; drivers?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (live) return;
    const [year, round, type] = sessionKey.split("_");
    let cancelled = false;
    setSoundSync(null);
    setSyncing(true);
    f1tv.sync(Number(year), Number(round), type)
      .then((r) => { if (!cancelled) setSoundSync(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [sessionKey, live]);
  const videoStart = main.debug.playback?.video_start_utc ?? null;
  const autoOffset =
    soundSync && link.includes(soundSync.content_id)
      ? soundSync.offset
      : replayStart !== null && videoStart !== null
        ? replayStart - videoStart + STAMP_DELAY_S
        : null;
  // A manual sync wins over the automatic one until it's cleared
  const mainOffset = live || aligning ? null : manualOffset ?? (autoOffset !== null ? autoOffset + mainNudge : null);
  // Lining up by hand is offered only when asked for, or once both automatic
  // ways have failed; never while the automatic sync is still working, when
  // playing the video by itself would just put it out of step
  const autoFailed =
    !live && !syncing && replayStartChecked && main.state === "ready" && autoOffset === null && manualOffset === null;

  // Live: the video plays at F1 TV's live pace, and carries the real time of
  // what it's showing (sent out a few seconds after it happened, like
  // replays' time stamps). The timing is held back until it shows the same
  // moment: delay = now - what the video shows - how late the data arrives.
  // The fine-tune buttons add to it.
  const [liveDelay, setLiveDelay] = useState<number | null>(null);
  // The gap between F1 TV's live stamps and the moment on screen, measured
  // by engine sound once there's a couple of minutes of driving (retried
  // every minute until then); the replay-measured gap until it is
  const [liveSound, setLiveSound] = useState<{ stamp_delay: number; drivers: string[] } | null>(null);
  useEffect(() => {
    if (!live || main.state !== "ready" || liveSound) return;
    const [year, round, type] = sessionKey.split("_");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      f1tv.liveSync(Number(year), Number(round), type)
        .then((r) => { if (!cancelled) setLiveSound(r); })
        .catch(() => { if (!cancelled) timer = setTimeout(attempt, 60_000); });
    };
    attempt();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [live, main.state, liveSound, sessionKey]);
  const stampDelay = liveSound?.stamp_delay ?? STAMP_DELAY_S;
  const sentDelay = useRef<number | null>(null);
  useEffect(() => {
    if (!live || main.state !== "ready") return;
    const tick = () => {
      const shown = main.playheadUtc();
      // Until the data's real time is known, assume it arrives about 2s late
      const lag = live.arrivalLag() ?? 2;
      if (shown === null) return;
      const delay = Math.max(0, Date.now() / 1000 - (shown - stampDelay) - lag + mainNudge);
      setLiveDelay(delay);
      // Small changes would only make the timing stutter
      if (sentDelay.current === null || Math.abs(delay - sentDelay.current) >= 0.3) {
        sentDelay.current = Math.round(delay * 10) / 10;
        live.onDelay(sentDelay.current);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live, main.state, main, mainNudge, stampDelay]);
  useEffect(() => () => live?.onDelay(null), [live]);
  // F1 TV's live video starts paused until asked to play
  useEffect(() => {
    if (live && main.state === "ready") void mainRef.current?.play().catch(() => {});
  }, [live, main.state]);
  const manualControls = aligning || autoFailed;
  // How this session is synced, for the hover controls
  const soundSynced = !!soundSync && link.includes(soundSync.content_id);
  const syncMethod: { label: string; hint: string; tone: "good" | "rough" | "busy" } | null = live
    ? liveDelay !== null
      ? liveSound
        ? {
            label: `Synced by engine sound (${liveSound.drivers.join(", ")}): timing delayed ${liveDelay.toFixed(1)}s`,
            hint: "The timing is held back to show the same moment as F1 TV's live video, measured by matching onboard engine sound to the drivers' revs. Accurate to a fraction of a second.",
            tone: "good",
          }
        : {
            label: `Synced by video time stamp (approximate): timing delayed ${liveDelay.toFixed(1)}s`,
            hint: "The timing is held back to show the same moment as F1 TV's live video, from the time stamps in the video. Matching the engine sound for a more exact sync once there's a couple of minutes of driving.",
            tone: "rough",
          }
      : main.state === "ready"
        ? { label: "Matching the timing to the live broadcast…", hint: "Waiting for the live timing and the video's clock.", tone: "busy" }
        : null
    : aligning
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
  // Fine-tuning keeps how it was synced, and says by how much
  if (syncMethod && !aligning && manualOffset === null && mainNudge !== 0) {
    syncMethod.label += ` · fine-tuned ${mainNudge > 0 ? "+" : ""}${mainNudge}s`;
    syncMethod.hint += " Then fine-tuned by hand.";
  }

  const clock = useReplayClock(timestamp, playing, speed);
  const mainDrift = useVideoSync(mainRef, main.state === "ready", clock, playing, speed, mainOffset);
  const broadcastClock = useCallback(() => mainRef.current?.currentTime ?? 0, []);
  const broadcastPlaying = live ? true : mainOffset !== null ? playing : !!mainRef.current && !mainRef.current.paused;

  useEffect(() => writeJson("f1tv_stream_opts", opts), [opts]);

  // No saved link: find this session's replay on F1 TV.
  useEffect(() => {
    if (link) return;
    const [year, round, type] = sessionKey.split("_");
    let cancelled = false;
    setFinding("searching");
    f1tv.find(Number(year), Number(round), type, !!live)
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
        // The live stream appears once F1 TV goes live: keep looking
        if (live) retryTimer = setTimeout(() => setFindAttempt((n) => n + 1), 30_000);
      });
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [link, sessionKey, linkKey, findAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look up the feeds for the saved link.
  useEffect(() => {
    if (!link) return;
    setContentError(null);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    f1tv.content(link).then(setContent).catch((e) => {
      setContent(null);
      // F1 TV only has a live stream's details once it's live: keep trying
      if (live) {
        setContentError("Waiting for F1 TV's live stream to start. Checking every 30 seconds.");
        retryTimer = setTimeout(() => setFindAttempt((n) => n + 1), 30_000);
      } else {
        setContentError(e.message);
      }
    });
    return () => clearTimeout(retryTimer);
  }, [link, findAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const mainFeeds = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && !isOnboard(c)), [content]);
  const onboards = useMemo(() => (content?.channels || []).filter((c) => c.channel_id && isOnboard(c) && c.driver_number), [content]);
  // An onboard's feed, by driver number
  const channelOf = (value: string | null) => {
    if (!value) return null;
    return onboards.find((c) => String(c.driver_number) === value)?.channel_id ?? null;
  };
  // Main + 2's side panel, as a share of the width: drag its edge to make
  // it narrower (never wider than the default). Remembered.
  const [sideShare, setSideShareState] = useState<number>(() => readJson("f1tv_side_share", SIDE_MAX));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const setRoot = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.current.observe(el);
  }, []);
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
  const mode: "single" | Layout = multiView ? layout : "single";
  const mainWidth = mode === "focus" ? `${(1 - sideShare) * 100}%` : "100%";
  // What each view shows: only what this session has (the broadcast, or an
  // onboard F1 TV lists), in the slots this layout has room for
  const visible = slots
    .slice(0, VIEW_COUNT[mode])
    .map((s) => (s === BROADCAST || channelOf(s) ? s : null));
  const shownCount = visible.filter(Boolean).length;
  const audible = audioPick && visible.includes(audioPick) ? audioPick : visible[0];
  const views = layoutViews(mode, size.w, size.h, sideShare, visible, showMap);
  const broadcastSlot = visible.indexOf(BROADCAST);
  const broadcastRect = broadcastSlot >= 0 ? views.rects[broadcastSlot] : null;
  const onboardViews = visible
    .flatMap((s, slot) => {
      const rect = views.rects[slot];
      const channel = channelOf(s);
      return s && s !== BROADCAST && rect && channel ? [{ number: s, slot, rect, channel }] : [];
    })
    // In a fixed order, so swapping views moves them without reloading
    .sort((a, b) => Number(a.number) - Number(b.number));

  useEffect(() => {
    const video = mainRef.current;
    if (!video) return;
    video.muted = muted || audible !== BROADCAST;
    video.volume = Math.max(0, Math.min(1, volume));
  }, [muted, volume, main.state, audible]);

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
    } else if (autoOffset !== null || live) {
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

  if (!link && live) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black px-6 text-center">
        <p className="text-xs text-f1-muted leading-relaxed max-w-sm">
          {findError ?? "F1 TV isn't streaming this session yet."} Checking again every 30 seconds.
        </p>
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

  // A view's own buttons: its sound, swapping into the main view, closing
  const viewButtons = (slot: number, source: Source): ViewButtonProps => ({
    audible: audible === source,
    audioTitle: audible === source
      ? audioPick === source && slot > 0 ? "Playing this view's sound. Click to follow the main view again" : "Playing this view's sound"
      : "Play this view's sound instead",
    // Only a choice when more than one view is showing
    onAudio: shownCount > 1 ? () => setAudioPick(slot === 0 || audioPick === source ? null : source) : undefined,
    onSwap: slot > 0 ? () => assign(0, source) : undefined,
    onClose: slot > 0 ? () => assign(slot, null) : undefined,
    controlsShown,
    clearOfPageButtons: slot === 0 && (mode === "single" || mode === "strip"),
  });
  const pickerFor = (slot: number, placeholder: string) => (
    <SourcePicker
      onboards={onboards}
      driversByNumber={driversByNumber}
      value={visible[slot] ?? null}
      placeholder={placeholder}
      clearable={slot > 0}
      onChange={(s) => assign(slot, s)}
    />
  );
  const reveal = controlsShown ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:pointer-events-none";
  const statusRect = broadcastRect ?? (contentError || main.state === "error" ? views.rects[0] ?? { x: 0, y: 0, w: size.w, h: size.h } : null);

  return (
    // isolate: the views stack among themselves, so the page's overlays
    // (lap notifications, team radio) always sit on top of them
    <div ref={setRoot} className="relative isolate w-full h-full bg-black overflow-hidden group">
      {/* Protected video can be drawn in its own hardware layer that ignores
          stacking, so views never overlap. The broadcast is what the timing
          and onboards follow, so it keeps playing, hidden, when no view
          shows it. */}
      <video
        ref={mainRef}
        className="absolute object-contain"
        style={broadcastRect ? place(broadcastRect) : HIDDEN}
        playsInline
      />

      {main.state !== "ready" && statusRect && (
        <div className="absolute z-10 flex flex-col items-center justify-center gap-3 px-6" style={place(statusRect)}>
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

      {/* The broadcast's buttons, when it's one of several views. Clicks
          pass through to the video (for lining up by hand). */}
      {mode !== "single" && broadcastRect && (
        <div className="absolute z-20 pointer-events-none has-[[data-open]]:z-40" style={place(broadcastRect)}>
          {broadcastSlot > 0 && (
            <div className={`absolute top-1.5 left-1.5 z-30 pointer-events-auto transition-opacity ${reveal}`}>
              {pickerFor(broadcastSlot, "Choose a view")}
            </div>
          )}
          <ViewButtons {...viewButtons(broadcastSlot, BROADCAST)} hover="view" />
        </div>
      )}

      {onboardViews.map(({ number, slot, rect, channel }) => (
        <OnboardPane
          key={number}
          rect={rect}
          link={link}
          channel={channel}
          opts={opts}
          mainRef={mainRef}
          mainUtc={live ? main.playheadUtc : undefined}
          mainReady={main.state === "ready"}
          playing={broadcastPlaying}
          speed={mainOffset !== null ? speed : 1}
          replaySpeed={speed}
          nudge={onboardNudge}
          driver={driversByNumber[number]}
          sectors={
            miniSectorData && driversByNumber[number]
              ? {
                  states: miniStatesAt(miniSectorData, driversByNumber[number].abbr, timestamp ?? 0),
                  counts: miniSectorData.counts,
                  ends: miniSectorData.ends,
                }
              : null
          }
          showSectors={sectorsOn[slot]}
          onToggleSectors={() => toggleSectors(slot)}
          showTelemetry={telemetryOn[slot]}
          onToggleTelemetry={() => toggleTelemetry(slot)}
          picker={slot > 0 ? pickerFor(slot, "Choose a view") : null}
          buttons={viewButtons(slot, number)}
          audible={audible === number}
          muted={muted}
          volume={volume}
        />
      ))}

      {/* Empty views: a placeholder with its picker */}
      {mode !== "single" && views.empty.map(({ slot, rect, compact }) => (
        <div key={`empty-${slot}`} className="absolute z-20 has-[[data-open]]:z-40" style={place(rect)}>
          {compact ? (
            pickerFor(slot, "Add another view")
          ) : (
            <div className="w-full h-full rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center gap-2">
              <span className="text-[10px] text-white/50">{onboards.length ? "Onboard camera" : "No onboards for this session"}</span>
              {pickerFor(slot, slot === 1 ? "Choose an onboard" : "Add another view")}
            </div>
          )}
        </div>
      ))}

      {raceControl && (
        <div
          className="absolute bottom-3 left-0 z-20 flex justify-center pointer-events-none"
          style={views.mainBottom !== null ? { width: mainWidth, bottom: size.h - views.mainBottom + 12 } : { width: mainWidth }}
        >
          <RaceControlTicker message={raceControl} />
        </div>
      )}

      {mode === "focus" && (
        // Drag the side panel's edge to make it narrower: shown on hover, or
        // after a tap on touch screens
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
      )}

      {views.map ? (
        // The map in its own space, with a margin so corner numbers aren't
        // cut off
        <div className="absolute z-20 px-4 py-3 pointer-events-none [&_.bg-f1-dark]:!bg-transparent" style={place(views.map)}>
          {trackOverlay}
        </div>
      ) : mode === "single" && showMap && (
        // Just the track lines over the video: the map's own background is
        // made transparent here. Above an onboard in the main view too.
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-[25] w-[26%] max-w-[340px] aspect-square pointer-events-none [&_.bg-f1-dark]:!bg-transparent">
          {trackOverlay}
        </div>
      )}

      {/* Controls */}
      {/* Shown on hover, or for a few seconds after a tap on touch screens
          (where hidden controls mustn't catch taps) */}
      <div className={`absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5 transition-opacity ${reveal}`}>
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
          {multiView && (
            <div className="flex rounded border border-f1-border overflow-hidden">
              {([
                ["focus", "Main view, with two smaller views and the track map beside it"],
                ["strip", "Main view, with four smaller views and the track map along the bottom"],
                ["pair", "Two views side by side, with the track map below"],
                ["quad", "Four views in a square, with the track map in the middle"],
                ["grid", "Grid: five views and the track map, all the same size"],
              ] as const).map(([value, title]) => (
                <button
                  key={value}
                  onClick={() => setLayout(value)}
                  title={title}
                  aria-label={title}
                  className={`px-1.5 py-1 transition-colors ${
                    layout === value ? "bg-white text-black" : "bg-f1-card/90 text-f1-muted hover:text-white"
                  }`}
                >
                  <LayoutIcon layout={value} active={layout === value} />
                </button>
              ))}
            </div>
          )}
        </div>
        {/* What the main view shows, and which broadcast feed */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/85 border border-f1-border">
          <span className="text-[9px] font-bold text-f1-muted uppercase tracking-wider mr-0.5">{multiView ? "Main view" : "Showing"}</span>
          {pickerFor(0, "Choose a view")}
          {broadcastSlot >= 0 && mainFeeds.length > 0 && (
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
        {!manualControls && (mainOffset !== null || (live && main.state === "ready")) && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/85 border border-f1-border">
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

/** One onboard camera in its view, following the broadcast's position. */
function OnboardPane({ rect, link, channel, opts, mainRef, mainUtc, mainReady, playing, speed, replaySpeed, nudge, driver, sectors, showSectors, onToggleSectors, showTelemetry, onToggleTelemetry, picker, buttons, audible, muted, volume }: {
  rect: Rect;
  link: string;
  channel: string;
  opts: StreamOptions;
  mainRef: React.RefObject<HTMLVideoElement | null>;
  /** Live: the real time the broadcast is showing */
  mainUtc?: () => number | null;
  mainReady: boolean;
  playing: boolean;
  speed: number;
  replaySpeed: number;
  nudge: number;
  driver?: ReplayDriver;
  showTelemetry: boolean;
  /** Shows or hides this onboard's telemetry for now (Settings > Broadcast sets the default) */
  onToggleTelemetry: () => void;
  /** This driver's mini-sectors now; null outside qualifying and practice */
  sectors: { states: number[] | null; counts: number[]; ends: number[] } | null;
  showSectors: boolean;
  onToggleSectors: () => void;
  /** Switches this view to another (on hover); none in the main view, whose
   *  picker is in the main controls */
  picker: React.ReactNode | null;
  buttons: ViewButtonProps;
  /** Whether this view's sound plays, at the player's volume */
  audible: boolean;
  muted: boolean;
  volume: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const stream = useF1TVStream(ref);
  // Replays: the feeds share one timeline, so follow the broadcast's
  // position. Live: their timelines can differ, so line them up by the real
  // time each is showing.
  const { playheadUtc } = stream;
  const broadcastClock = useCallback(() => {
    const video = ref.current;
    if (mainUtc && video) {
      const m = mainUtc();
      const own = playheadUtc();
      if (m !== null && own !== null) return video.currentTime + (m - own);
      return video.currentTime;
    }
    return mainRef.current?.currentTime ?? 0;
  }, [mainRef, mainUtc, playheadUtc]);
  useVideoSync(ref, stream.state === "ready" && mainReady, broadcastClock, playing, speed, nudge);
  useEffect(() => {
    void stream.load(link, channel, opts);
    return () => { void stream.unload(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, channel, opts]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted || !audible;
    video.volume = Math.max(0, Math.min(1, volume));
  }, [audible, muted, volume, stream.state]);

  return (
    <div className="absolute z-20 group/pane has-[[data-open]]:z-40" style={place(rect)}>
      {/* The picker sits outside the rounded frame so its menu isn't cut off */}
      {picker && (
        <div className={`absolute top-1.5 left-1.5 z-30 transition-opacity ${buttons.controlsShown ? "opacity-100" : "opacity-0 group-hover/pane:opacity-100 focus-within:opacity-100 [@media(hover:none)]:pointer-events-none"}`}>{picker}</div>
      )}
      <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-white/10">
        <video ref={ref} className="w-full h-full object-contain" muted playsInline />
        {sectors && showSectors && <SectorStrip {...sectors} />}
        {showTelemetry && <OnboardTelemetry driver={driver} speed={replaySpeed} raised={!!sectors && showSectors} />}
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
      <ViewButtons
        {...buttons}
        hover="pane"
        extra={driver && ([
          ["Telemetry", showTelemetry, onToggleTelemetry, "telemetry on this onboard"],
          ...(sectors ? ([["Sectors", showSectors, onToggleSectors, "this onboard's mini-sectors along the bottom"]] as const) : []),
        ] as const).map(([label, on, toggle, what]) => (
          <button
            key={label}
            onClick={toggle}
            className={`h-6 px-2 rounded-full bg-black/70 text-[10px] font-bold flex items-center gap-1 ${on ? "text-white" : "text-white/60 hover:text-white"}`}
            title={`${on ? "Hide" : "Show"} ${what}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-green-400" : "bg-white/30"}`} />
            {label}
          </button>
        ))}
      />
    </div>
  );
}

type ViewButtonProps = {
  audible: boolean;
  audioTitle: string;
  onAudio?: () => void;
  onSwap?: () => void;
  onClose?: () => void;
  controlsShown: boolean;
  /** Single view: below the page's own buttons in the top-right corner */
  clearOfPageButtons: boolean;
};

/** A view's buttons, top right, on hover: any switches of its own, its
 *  sound, swap into the main view, and close. */
function ViewButtons({ audible, audioTitle, onAudio, onSwap, onClose, controlsShown, clearOfPageButtons, hover, extra }: ViewButtonProps & {
  /** Shown on hovering this view, or (over the broadcast, which lets clicks
   *  through) anywhere on the player */
  hover: "pane" | "view";
  extra?: React.ReactNode;
}) {
  if (!onAudio && !onSwap && !onClose && !extra) return null;
  const round = "w-6 h-6 rounded-full bg-black/70 flex items-center justify-center";
  return (
    <div className={`absolute ${clearOfPageButtons ? "top-12 right-3" : "top-1.5 right-1.5"} z-30 flex items-start gap-1 pointer-events-auto transition-opacity ${
      controlsShown ? "opacity-100" : `opacity-0 ${hover === "pane" ? "group-hover/pane:opacity-100" : "group-hover:opacity-100"} [@media(hover:none)]:pointer-events-none`
    }`}>
      {extra && <div className="flex flex-col items-end gap-1">{extra}</div>}
      {onAudio && (
        <button onClick={onAudio} className={`${round} ${audible ? "text-white" : "text-white/50 hover:text-white"}`} title={audioTitle} aria-label={audioTitle}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" />
            {audible ? <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
          </svg>
        </button>
      )}
      {onSwap && (
        <button onClick={onSwap} className={`${round} text-white/80 hover:text-white text-xs`} title="Swap with the main view" aria-label="Swap with the main view">
          ⇄
        </button>
      )}
      {onClose && (
        <button onClick={onClose} className={`${round} text-white/80 hover:text-white text-sm leading-none`} title="Close this view" aria-label="Close this view">
          ×
        </button>
      )}
    </div>
  );
}

/** A layout drawn as boxes: the views filled, the track map outlined. */
function LayoutIcon({ layout, active }: { layout: Layout; active: boolean }) {
  // Over the views (2×2), the map is cut out in the button's colour
  const map = (x: number, y: number, w: number, h: number, over = false) => (
    <rect
      x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={0.8}
      className={over ? (active ? "fill-white" : "fill-f1-card") : undefined}
      fill={over ? undefined : "none"}
      stroke="currentColor" strokeWidth={1}
    />
  );
  return (
    <svg width="27" height="15" viewBox="0 0 27 15" fill="currentColor" aria-hidden>
      {layout === "focus" ? (
        <>
          <rect x={0} y={0} width={18} height={15} rx={1} />
          <rect x={19.5} y={0} width={7.5} height={4.2} rx={0.8} />
          <rect x={19.5} y={5.2} width={7.5} height={4.2} rx={0.8} />
          {map(19.5, 10.4, 7.5, 4.6)}
        </>
      ) : layout === "strip" ? (
        <>
          <rect x={0} y={0} width={27} height={10.5} rx={1} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 5.6} y={11.5} width={4.8} height={3.5} rx={0.6} />
          ))}
          {map(22.4, 11.5, 4.6, 3.5)}
        </>
      ) : layout === "pair" ? (
        <>
          <rect x={0} y={0} width={13} height={8} rx={0.8} />
          <rect x={14} y={0} width={13} height={8} rx={0.8} />
          {map(8.5, 9, 10, 6)}
        </>
      ) : layout === "quad" ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={(i % 2) * 14} y={Math.floor(i / 2) * 8} width={13} height={7} rx={0.8} />
          ))}
          {map(10.5, 4.5, 6, 6, true)}
        </>
      ) : (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={(i % 3) * 9.25} y={Math.floor(i / 3) * 8} width={8.5} height={7} rx={0.8} />
          ))}
          {map(18.5, 8, 8.5, 7)}
        </>
      )}
    </svg>
  );
}

/** Choose what a view shows: the broadcast, or a driver's onboard (styled
 *  like Lap Analysis's driver menus). Drivers are in running order; ones not
 *  in the timing still show, from F1 TV's list. Choosing one that another
 *  view shows swaps the two. */
function SourcePicker({ onboards, driversByNumber, value, placeholder, clearable, onChange }: {
  onboards: F1TVChannel[];
  driversByNumber: Record<string, ReplayDriver>;
  value: Source | null;
  placeholder: string;
  clearable: boolean;
  onChange: (value: Source | null) => void;
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
    .sort((a, b) => a.position - b.position || a.number - b.number);

  const selectedDriver = drivers.find((d) => d.value === value);
  const pick = (v: Source | null) => { onChange(v); setOpen(false); };
  // Opens upwards when there isn't room below (views along the bottom, above
  // the playback controls)
  const [up, setUp] = useState(false);
  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!open && rect) setUp(window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight - rect.bottom);
    setOpen(!open);
  };
  const row = "w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors text-left";

  // data-open lifts its view above the others and the track map
  return (
    <div ref={ref} data-open={open || undefined} className="relative w-44 pointer-events-auto">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-left hover:border-f1-muted transition-colors"
      >
        {value === BROADCAST ? (
          <>
            <span className="w-2 h-2 rounded-sm bg-f1-red flex-shrink-0" />
            <span className="text-xs font-bold text-white">Broadcast</span>
          </>
        ) : selectedDriver ? (
          <>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selectedDriver.color }} />
            <span className="text-xs font-bold text-white">{selectedDriver.abbr}</span>
            <span className="text-[10px] text-f1-muted truncate">onboard</span>
          </>
        ) : (
          <span className="text-xs text-f1-muted">{placeholder}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-f1-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`absolute ${up ? "bottom-full mb-1" : "top-full mt-1"} left-0 right-0 bg-f1-dark border border-f1-border rounded shadow-xl z-50 max-h-[260px] overflow-y-auto`}>
          {value && clearable && (
            <button onClick={() => pick(null)} className={`${row} text-xs text-f1-muted`}>Clear</button>
          )}
          <button onClick={() => pick(BROADCAST)} className={`${row} ${value === BROADCAST ? "bg-white/10" : ""}`}>
            <span className="w-2 h-2 rounded-sm bg-f1-red flex-shrink-0" />
            <span className="w-4" />
            <span className="text-xs font-bold text-white">Broadcast</span>
          </button>
          {drivers.map((d) => (
            <button key={d.value} onClick={() => pick(d.value)} className={`${row} ${d.value === value ? "bg-white/10" : ""}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[10px] font-bold text-f1-muted w-4 text-right">{d.position < 99 ? d.position : ""}</span>
              <span className="text-xs font-bold text-white">{d.abbr}</span>
              <span className="text-[10px] text-f1-muted truncate">{d.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A slim telemetry strip along the bottom of an onboard: driver, speed,
 *  gear, a throttle gauge, a brake tag that lights up, and DRS when open. Replay
 *  frames come every half second of race time, so the gauge glides from one
 *  reading to the next over that time rather than stepping. */
/** The driver's mini-sectors as one line along the bottom edge: a block per
 *  mini-sector, as long as it is on track, coloured as it's completed
 *  (purple, green, yellow), with a wider gap between the three sectors. */
function SectorStrip({ states, counts, ends }: { states: number[] | null; counts: number[]; ends: number[] }) {
  const sectorEnds = new Set(counts.map((_, s) => counts.slice(0, s + 1).reduce((a, b) => a + b, 0) - 1));
  return (
    <div className="absolute bottom-0 inset-x-0 h-1.5 flex bg-black/40">
      {ends.map((end, i) => {
        const status = states?.[i] ?? 0;
        const color = MINI_HEX[status] ?? (status === MINI_PIT ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)");
        const last = i === ends.length - 1;
        return (
          <span
            key={i}
            className={`h-full ${last ? "" : sectorEnds.has(i) ? "border-r-2 border-black" : "border-r border-black/70"}`}
            style={{ width: `${(end - (i ? ends[i - 1] : 0)) * 100}%`, backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}

function OnboardTelemetry({ driver, speed, raised = false }: { driver?: ReplayDriver; speed: number; raised?: boolean }) {
  if (!driver || driver.speed == null) return null;
  const throttle = Math.max(0, Math.min(100, driver.throttle ?? 0));
  const drsOpen = (driver.drs ?? 0) >= 10;
  const frameMs = Math.round(500 / Math.max(speed, 0.25));
  return (
    <div className={`absolute ${raised ? "bottom-3" : "bottom-1.5"} inset-x-0 mx-auto w-fit max-w-[calc(100%-0.75rem)] flex items-center gap-2 h-6 pl-1.5 pr-2 rounded-full bg-black/65 backdrop-blur-sm border border-white/10 text-white tabular-nums`}>
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
