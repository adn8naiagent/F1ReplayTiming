"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { getToken, clearToken } from "@/lib/auth";
import type { ReplayFrame, ReplayState, QualiPhaseInfo } from "./useReplaySocket";

// Plays a replay in the browser from static chunk files (about a minute of
// frames each), instead of having the server stream every frame. Same
// controls and state as useReplaySocket, so the page doesn't care which runs.

interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  frames: number;
}

interface Manifest {
  version: string;
  total_frames: number;
  total_time: number;
  total_laps: number;
  quali_phases: QualiPhaseInfo[] | null;
  laps: [number, number][];
  chunks: ChunkInfo[];
}

export interface StaticReplayState extends ReplayState {
  /** Set when the static files can't be used at all; the page falls back to the WebSocket player. */
  fatal: boolean;
}

const TICK_MS = 50;
const POLL_MS = 1500;

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }
}

/** Index of the last item whose key is <= value (or 0 if none). */
function lastAtOrBefore<T>(items: T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function useReplayPlayer(year: number, round: number, sessionType: string, enabled: boolean) {
  const [state, setState] = useState<StaticReplayState>({
    connected: false,
    reconnecting: false,
    ready: false,
    loading: true,
    playing: false,
    speed: 1,
    frame: null,
    totalTime: 0,
    totalLaps: 0,
    qualiPhases: [],
    finished: false,
    error: null,
    statusMessage: null,
    fatal: false,
  });

  const manifestRef = useRef<Manifest | null>(null);
  const chunksRef = useRef(new Map<number, ReplayFrame[]>());
  const pendingRef = useRef(new Map<number, Promise<ReplayFrame[]>>());
  const frameRef = useRef<ReplayFrame | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  // Playhead: session time = anchorTime + elapsed wall time * speed
  const anchorTimeRef = useRef(0);
  const anchorWallRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);
  const generationRef = useRef(0); // bumps on session change so stale loads are ignored

  const chunkUrl = useCallback(
    (index: number) => {
      const m = manifestRef.current!;
      const name = `chunk-${String(index).padStart(4, "0")}.json`;
      return apiUrl(`/api/data/sessions/${year}/${round}/${sessionType}/replay/${m.version}/${name}`);
    },
    [year, round, sessionType],
  );

  /** Chunk (position in manifest.chunks) that covers session time t. */
  const chunkPosFor = useCallback((t: number) => {
    const chunks = manifestRef.current?.chunks || [];
    return lastAtOrBefore(chunks, t, (c) => c.start);
  }, []);

  const loadChunk = useCallback(
    (pos: number): Promise<ReplayFrame[]> => {
      const info = manifestRef.current?.chunks[pos];
      if (!info) return Promise.resolve([]);
      const cached = chunksRef.current.get(info.index);
      if (cached) return Promise.resolve(cached);
      const pending = pendingRef.current.get(info.index);
      if (pending) return pending;

      const generation = generationRef.current;
      const attempt = async (delay: number): Promise<ReplayFrame[]> => {
        try {
          const res = await fetch(chunkUrl(info.index), { headers: authHeaders() });
          handleUnauthorized(res);
          if (!res.ok) throw new Error(`Chunk ${info.index}: ${res.status}`);
          const frames: ReplayFrame[] = await res.json();
          if (generation === generationRef.current) {
            chunksRef.current.set(info.index, frames);
            setState((s) => (s.reconnecting ? { ...s, reconnecting: false, connected: true } : s));
          }
          return frames;
        } catch (e) {
          if (!aliveRef.current || generation !== generationRef.current) throw e;
          // Network blip: show the reconnecting banner and keep trying.
          setState((s) => ({ ...s, reconnecting: true }));
          await new Promise((r) => setTimeout(r, delay));
          return attempt(Math.min(delay * 2, 15000));
        }
      };
      const p = attempt(1000).finally(() => pendingRef.current.delete(info.index));
      pendingRef.current.set(info.index, p);
      return p;
    },
    [chunkUrl],
  );

  /** Keep the current chunk and the ones just ahead; drop the rest. */
  const manageChunks = useCallback(
    (pos: number) => {
      const chunks = manifestRef.current?.chunks || [];
      const ahead = 1 + Math.ceil(speedRef.current / 15);
      const keep = new Set<number>();
      for (let p = Math.max(0, pos - 1); p <= Math.min(chunks.length - 1, pos + ahead); p++) {
        keep.add(chunks[p].index);
        if (p > pos) loadChunk(p).catch(() => {});
      }
      chunksRef.current.forEach((_, index) => {
        if (!keep.has(index)) chunksRef.current.delete(index);
      });
    },
    [loadChunk],
  );

  const show = useCallback((frame: ReplayFrame | null) => {
    if (!frame || frame === frameRef.current) return;
    frameRef.current = frame;
    setState((s) => ({ ...s, frame }));
  }, []);

  /** Frame playing at session time t, or null if its chunk isn't loaded yet. */
  const frameAt = useCallback(
    (t: number): ReplayFrame | null => {
      const info = manifestRef.current?.chunks[chunkPosFor(t)];
      const frames = info && chunksRef.current.get(info.index);
      if (!frames || frames.length === 0) return null;
      return frames[lastAtOrBefore(frames, t, (f) => f.timestamp)];
    },
    [chunkPosFor],
  );

  /** First frame at or after t (what the server player seeks to). */
  const firstFrameFrom = useCallback(
    async (t: number): Promise<ReplayFrame | null> => {
      const chunks = manifestRef.current?.chunks || [];
      for (let pos = chunkPosFor(t); pos < chunks.length; pos++) {
        const frames = await loadChunk(pos);
        const hit = frames.find((f) => f.timestamp >= t);
        if (hit) return hit;
      }
      return null;
    },
    [chunkPosFor, loadChunk],
  );

  const currentTime = useCallback(() => {
    if (!playingRef.current) return anchorTimeRef.current;
    return anchorTimeRef.current + ((performance.now() - anchorWallRef.current) / 1000) * speedRef.current;
  }, []);

  const anchorAt = useCallback((t: number) => {
    anchorTimeRef.current = t;
    anchorWallRef.current = performance.now();
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const tick = useCallback(() => {
    const m = manifestRef.current;
    if (!m || !playingRef.current) return;
    const t = currentTime();

    if (t >= m.total_time) {
      const lastPos = m.chunks.length - 1;
      loadChunk(lastPos).then((frames) => show(frames[frames.length - 1] || null)).catch(() => {});
      playingRef.current = false;
      anchorAt(m.total_time);
      stopTimer();
      setState((s) => ({ ...s, playing: false, finished: true }));
      return;
    }

    const frame = frameAt(t);
    if (!frame) {
      // Chunk hasn't arrived yet: hold the playhead here until it does.
      anchorAt(t);
      loadChunk(chunkPosFor(t)).catch(() => {});
      return;
    }
    show(frame);
    manageChunks(chunkPosFor(t));
  }, [currentTime, frameAt, show, manageChunks, chunkPosFor, loadChunk, anchorAt, stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(tick, TICK_MS);
  }, [stopTimer, tick]);

  // Load the manifest (waiting while the server prepares it), then the first frame.
  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return;
    const generation = ++generationRef.current;
    manifestRef.current = null;
    chunksRef.current = new Map();
    pendingRef.current = new Map();
    frameRef.current = null;
    playingRef.current = false;
    anchorAt(0);
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const stale = () => !aliveRef.current || generation !== generationRef.current;

    const poll = async () => {
      try {
        const res = await fetch(apiUrl(`/api/sessions/${year}/${round}/replay?type=${sessionType}`), {
          headers: authHeaders(),
        });
        if (stale()) return;
        handleUnauthorized(res);
        const body = await res.json().catch(() => ({}));
        if (stale()) return;

        if (res.status === 202) {
          failures = 0;
          setState((s) => ({ ...s, loading: true, statusMessage: body.message || "Preparing replay..." }));
          pollTimer = setTimeout(poll, POLL_MS);
          return;
        }
        if (res.status === 404 && body.state === "unavailable") {
          setState((s) => ({ ...s, loading: false, error: body.message || "Session unavailable" }));
          return;
        }
        if (!res.ok || !body.manifest) {
          // Static files can't be served here; let the page use the WebSocket player.
          setState((s) => ({ ...s, loading: false, fatal: true, error: body.message || `Error ${res.status}` }));
          return;
        }

        const m: Manifest = body.manifest;
        manifestRef.current = m;
        const first = await firstFrameFrom(0);
        if (stale()) return;
        if (!first) {
          setState((s) => ({ ...s, loading: false, error: "No position data available" }));
          return;
        }
        anchorAt(first.timestamp);
        frameRef.current = first;
        manageChunks(0);
        setState((s) => ({
          ...s,
          connected: true,
          reconnecting: false,
          ready: true,
          loading: false,
          statusMessage: null,
          frame: first,
          totalTime: m.total_time,
          totalLaps: m.total_laps,
          qualiPhases: m.quali_phases || [],
        }));
      } catch {
        if (stale()) return;
        failures += 1;
        if (failures >= 5) {
          setState((s) => ({ ...s, loading: false, fatal: true, error: "Could not load replay files" }));
          return;
        }
        pollTimer = setTimeout(poll, Math.min(1000 * 2 ** failures, 10000));
      }
    };

    setState((s) => ({
      ...s,
      ready: false,
      loading: true,
      playing: false,
      finished: false,
      frame: null,
      error: null,
      fatal: false,
      statusMessage: null,
    }));
    poll();

    return () => {
      aliveRef.current = false;
      if (pollTimer) clearTimeout(pollTimer);
      stopTimer();
    };
  }, [year, round, sessionType, enabled, firstFrameFrom, manageChunks, anchorAt, stopTimer]);

  const seek = useCallback(
    async (time: number) => {
      const m = manifestRef.current;
      if (!m) return;
      const frame = await firstFrameFrom(Math.max(0, time));
      if (!frame) return;
      anchorAt(frame.timestamp);
      show(frame);
      manageChunks(chunkPosFor(frame.timestamp));
      setState((s) => ({ ...s, finished: false }));
    },
    [firstFrameFrom, anchorAt, show, manageChunks, chunkPosFor],
  );

  const play = useCallback(() => {
    const m = manifestRef.current;
    if (!m) return;
    // At the end, play starts again from the beginning.
    anchorAt(anchorTimeRef.current >= m.total_time ? 0 : anchorTimeRef.current);
    playingRef.current = true;
    startTimer();
    setState((s) => ({ ...s, playing: true, finished: false }));
  }, [anchorAt, startTimer]);

  const pause = useCallback(() => {
    anchorAt(currentTime());
    playingRef.current = false;
    stopTimer();
    setState((s) => ({ ...s, playing: false }));
  }, [anchorAt, currentTime, stopTimer]);

  const setSpeed = useCallback(
    (speed: number) => {
      const clamped = Math.max(0.25, Math.min(50, speed));
      anchorAt(currentTime()); // re-anchor so the playhead doesn't jump
      speedRef.current = clamped;
      setState((s) => ({ ...s, speed: clamped }));
    },
    [anchorAt, currentTime],
  );

  const seekToLap = useCallback(
    (lap: number) => {
      const entry = manifestRef.current?.laps.find(([l]) => l >= lap);
      if (entry) seek(entry[1]);
    },
    [seek],
  );

  const reset = useCallback(() => {
    playingRef.current = false;
    stopTimer();
    setState((s) => ({ ...s, playing: false, finished: false }));
    seek(0);
  }, [stopTimer, seek]);

  /** Frames around a lap, for matching a leaderboard typed in or read from a photo. */
  const framesNearLap = useCallback(
    async (lap: number): Promise<ReplayFrame[]> => {
      const m = manifestRef.current;
      if (!m) return [];
      const startEntry = m.laps.find(([l]) => l >= lap - 1);
      const endEntry = m.laps.find(([l]) => l >= lap + 2);
      const start = startEntry ? startEntry[1] : 0;
      const end = endEntry ? endEntry[1] : m.total_time;
      const frames: ReplayFrame[] = [];
      for (let pos = chunkPosFor(start); pos < m.chunks.length && m.chunks[pos].start <= end; pos++) {
        // Fetched directly so it doesn't disturb the playback buffer.
        const res = await fetch(chunkUrl(m.chunks[pos].index), { headers: authHeaders() });
        handleUnauthorized(res);
        if (!res.ok) throw new Error(`Could not load replay data (${res.status})`);
        frames.push(...((await res.json()) as ReplayFrame[]));
      }
      return frames;
    },
    [chunkPosFor, chunkUrl],
  );

  return { ...state, play, pause, setSpeed, seek, seekToLap, reset, framesNearLap };
}
