"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "@/lib/api";
import type { ReplayDriver, ReplayFrame, WeatherData, QualiPhase, RCMessage, QualiPhaseInfo } from "./useReplaySocket";
import type { LapEntry } from "@/components/Leaderboard";

export { type ReplayDriver, type ReplayFrame, type WeatherData, type QualiPhase, type RCMessage };

interface LiveState {
  connected: boolean;
  ready: boolean;
  loading: boolean;
  frame: ReplayFrame | null;
  rcMessages: RCMessage[];
  finished: boolean;
  sessionEnded: boolean;
  error: string | null;
  /** Why the server can't get data from F1 (e.g. refused), while retrying */
  feedError: string | null;
  /** Laps completed so far, on the frames' clock (null until the first list) */
  laps: LapEntry[] | null;
  qualiPhases: QualiPhaseInfo[];
  /** When the session started, on the frames' clock */
  sessionStart: number | null;
  /** Delayed, but with no timing that old yet (the server only just
   *  connected): seconds until there is, else null */
  delayWait: number | null;
}

// How long frames are kept (more while the delay is longer)
const KEEP_MS = 130_000;

interface BufferedFrame {
  frame: ReplayFrame;
  rcMessages: RCMessage[];
  receivedAt: number; // Date.now() when received
}

export function useLiveSocket(
  year: number,
  round: number,
  sessionType: string = "R",
  speed: number = 10,
  delayOffset: number = 0,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<BufferedFrame[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayRef = useRef(delayOffset);
  delayRef.current = delayOffset;
  // The frame showing, while delayed
  const shownRef = useRef<BufferedFrame | null>(null);
  const lagsRef = useRef<number[]>([]);
  const arrivalLagRef = useRef<number | null>(null);
  /** Seconds between data happening and reaching this page (live only) */
  const arrivalLag = useCallback(() => arrivalLagRef.current, []);
  const [state, setState] = useState<LiveState>({
    connected: false,
    ready: false,
    loading: true,
    frame: null,
    rcMessages: [],
    finished: false,
    sessionEnded: false,
    error: null,
    feedError: null,
    laps: null,
    qualiPhases: [],
    sessionStart: null,
    delayWait: null,
  });

  // Delay: every frame is kept for a couple of minutes (the server sends
  // its last two minutes on connecting too), and the page shows the newest
  // one at least |delayOffset| seconds old. When the delay grows (the
  // broadcast comes on) it goes straight back to that moment rather than
  // waiting for it; when it shrinks it skips forward.
  const absDelay = Math.abs(delayOffset);
  useEffect(() => {
    if (absDelay === 0) {
      shownRef.current = null;
      setState((s) => (s.delayWait === null ? s : { ...s, delayWait: null }));
      const latest = bufferRef.current[bufferRef.current.length - 1];
      if (latest) setState((s) => ({ ...s, frame: latest.frame, rcMessages: latest.rcMessages }));
      return;
    }

    const delayMs = absDelay * 1000;
    const show = () => {
      const now = Date.now();
      const buffer = bufferRef.current;
      if (!buffer.length) return;
      let idx = -1;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (now - buffer[i].receivedAt >= delayMs) {
          idx = i;
          break;
        }
      }
      // Nothing that old yet: the oldest there is, the nearest to it
      const wait = idx < 0 ? Math.ceil((delayMs - (now - buffer[0].receivedAt)) / 1000) : null;
      setState((s) => (s.delayWait === wait ? s : { ...s, delayWait: wait }));
      const entry = buffer[Math.max(0, idx)];
      if (entry !== shownRef.current) {
        shownRef.current = entry;
        setState((s) => ({ ...s, frame: entry.frame, rcMessages: entry.rcMessages }));
      }
    };
    show();
    timerRef.current = setInterval(show, 200);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [absDelay]);

  const keepFrame = (frame: ReplayFrame, rcMessages: RCMessage[], receivedAt: number) => {
    const buffer = bufferRef.current;
    buffer.push({ frame, rcMessages, receivedAt });
    const cutoff = Date.now() - Math.max(KEEP_MS, (Math.abs(delayRef.current) + 10) * 1000);
    let old = 0;
    while (old < buffer.length && buffer[old].receivedAt < cutoff) old++;
    if (old) buffer.splice(0, old);
  };

  useEffect(() => {
    let aborted = false;
    bufferRef.current = [];
    shownRef.current = null;
    const url = wsUrl(`/ws/live/${year}/${round}?type=${sessionType}&speed=${speed}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!aborted) setState((s) => ({ ...s, connected: true }));
    };

    ws.onmessage = (event) => {
      if (aborted) return;
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "status":
          setState((s) => ({ ...s, loading: true }));
          break;
        case "ready":
          setState((s) => ({
            ...s,
            ready: true,
            loading: false,
          }));
          break;
        case "frame": {
          const frame = toFrame(msg);
          const rcMessages: RCMessage[] = msg.rc_messages || [];
          // How long after it happened each frame reaches us: the lowest of
          // recent ones (frames come in batches), for the broadcast's delay
          if (typeof msg.utc === "number") {
            const lags = lagsRef.current;
            lags.push(Date.now() / 1000 - msg.utc);
            if (lags.length > 30) lags.shift();
            arrivalLagRef.current = Math.min(...lags);
          }

          keepFrame(frame, rcMessages, Date.now());
          // No delay: show it now (with one, the timer picks the frame)
          if (delayRef.current === 0) setState((s) => ({ ...s, frame, rcMessages }));
          break;
        }
        // The server's last two minutes, on connecting: placed as if they'd
        // arrived as they happened, the newest just now
        case "history": {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const frames: any[] = (msg.frames || []).filter((m: any) => typeof m.utc === "number");
          if (!frames.length) break;
          const newest = frames[frames.length - 1].utc;
          const now = Date.now();
          for (const m of frames) keepFrame(toFrame(m), m.rc_messages || [], now - (newest - m.utc) * 1000);
          break;
        }
        case "finished":
          setState((s) => ({
            ...s,
            finished: true,
            sessionEnded: true,
          }));
          break;
        case "error":
          setState((s) => ({ ...s, error: msg.message, loading: false }));
          break;
        case "feed_error":
          setState((s) => ({ ...s, feedError: msg.message ?? null }));
          break;
        // Not buffered for the broadcast delay: laps carry their completion
        // time, and are only shown once the (delayed) frame reaches it
        case "laps":
          setState((s) => ({
            ...s,
            laps: msg.laps || [],
            qualiPhases: msg.quali_phases || [],
            sessionStart: msg.session_start ?? null,
          }));
          break;
      }
    };

    ws.onerror = () => {
      if (!aborted) {
        setState((s) => ({ ...s, error: "WebSocket connection error", loading: false }));
      }
    };

    ws.onclose = () => {
      if (!aborted) {
        setState((s) => ({ ...s, connected: false }));
      }
    };

    return () => {
      aborted = true;
      ws.close();
    };
  }, [year, round, sessionType, speed]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  return { ...state, send, arrivalLag };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFrame(msg: any): ReplayFrame {
  return {
    timestamp: msg.timestamp,
    lap: msg.lap,
    total_laps: msg.total_laps,
    session_type: msg.session_type,
    drivers: msg.drivers,
    status: msg.status,
    weather: msg.weather,
    quali_phase: msg.quali_phase,
    team_radio: msg.team_radio,
    mini_sector_counts: msg.mini_sector_counts,
    mini_sector_ends: msg.mini_sector_ends,
    signed_in: msg.signed_in,
    utc: msg.utc,
    sector_flags: msg.sector_flags,
  };
}
