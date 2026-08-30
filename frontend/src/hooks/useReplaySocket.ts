"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "@/lib/api";

export interface ReplayDriver {
  abbr: string;
  x: number;
  y: number;
  color: string;
  team: string;
  position: number | null;
  grid_position: number | null;
  compound: string | null;
  tyre_life: number | null;
  pit_stops: number;
  in_pit: boolean;
  pit_time: number | null;
  finished: boolean;
  tyre_history: string[];
  gap: string | null;
  interval: string | null;
  best_lap_time: string | null;
  has_fastest_lap: boolean;
  flag: "investigation" | "penalty" | null;
  retired: boolean;
  knocked_out?: boolean;
  pit_start: boolean;
  no_timing: boolean;
  relative_distance: number;
  speed: number | null;
  throttle: number | null;
  brake: boolean;
  gear: number | null;
  rpm: number | null;
  drs: number | null;
  pit_prediction: number | null;
  pit_prediction_margin: number | null;
  pit_prediction_free_air: number | null;
  sectors: { num: number; color: "purple" | "green" | "yellow" }[] | null;
}

export interface WeatherData {
  air_temp: number;
  track_temp: number;
  humidity: number;
  rainfall: boolean;
  wind_speed: number;
  wind_direction: number;
}

export interface QualiPhase {
  phase: string;  // "Q1", "Q2", "Q3"
  elapsed: number;
  remaining: number;
}

export interface RCMessage {
  message: string;
  category: string;
  timestamp: number;
  lap?: number;
  racing_number?: string;
}

export interface ReplayFrame {
  timestamp: number;
  lap: number;
  total_laps: number;
  session_type?: string;
  drivers: ReplayDriver[];
  status: string;
  weather?: WeatherData;
  quali_phase?: QualiPhase;
  rc_messages?: RCMessage[];
  red_flag_end?: number;
  sector_flags?: { sector: number; flag: string; driver: string }[];
}

export interface QualiPhaseInfo {
  phase: string;
  timestamp: number;
}

interface ReplayState {
  connected: boolean;
  reconnecting: boolean;
  ready: boolean;
  loading: boolean;
  playing: boolean;
  speed: number;
  frame: ReplayFrame | null;
  totalTime: number;
  totalLaps: number;
  qualiPhases: QualiPhaseInfo[];
  finished: boolean;
  error: string | null;
  statusMessage: string | null;
}

export function useReplaySocket(year: number, round: number, sessionType: string = "R") {
  const wsRef = useRef<WebSocket | null>(null);
  // Reconnect bookkeeping. Without this a dropped socket — a proxy idle
  // timeout, a network blip — freezes the UI permanently with no feedback.
  const unmountedRef = useRef(false);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTimestampRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const [state, setState] = useState<ReplayState>({
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
  });

  useEffect(() => {
    unmountedRef.current = false;
    attemptRef.current = 0;
    lastTimestampRef.current = 0;
    wasPlayingRef.current = false;

    const connect = () => {
    const url = wsUrl(`/ws/replay/${year}/${round}?type=${sessionType}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setState((s) => ({ ...s, connected: true, reconnecting: false }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "ping":
          // Server keep-alive so proxies don't time the socket out. Nothing to do.
          break;
        case "status":
          setState((s) => ({ ...s, loading: true, statusMessage: msg.message || null }));
          break;
        case "ready":
          setState((s) => ({
            ...s,
            ready: true,
            loading: false,
            statusMessage: null,
            totalTime: msg.total_time,
            totalLaps: msg.total_laps,
            qualiPhases: msg.quali_phases || [],
          }));
          // Seek to where we were so a reconnect resumes in place; 0 on a
          // first connect, which also makes cars visible before play.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`seek:${lastTimestampRef.current}`);
            if (wasPlayingRef.current) ws.send("play");
          }
          break;
        case "frame":
          lastTimestampRef.current = msg.timestamp;
          setState((s) => ({
            ...s,
            frame: {
              timestamp: msg.timestamp,
              lap: msg.lap,
              total_laps: msg.total_laps,
              session_type: msg.session_type,
              drivers: msg.drivers,
              status: msg.status,
              weather: msg.weather,
              quali_phase: msg.quali_phase,
              rc_messages: msg.rc_messages,
              red_flag_end: msg.red_flag_end,
              sector_flags: msg.sector_flags,
            },
          }));
          break;
        case "finished":
          wasPlayingRef.current = false;
          setState((s) => ({ ...s, playing: false, finished: true }));
          break;
        case "error":
          setState((s) => ({ ...s, error: msg.message, loading: false }));
          break;
      }
    };

    ws.onerror = () => {
      // onclose always follows, and handles retrying.
      setState((s) => ({ ...s, loading: false }));
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (unmountedRef.current) return;

      // Retry with backoff, capped, so a transient drop recovers on its own.
      const delay = Math.min(1000 * 2 ** attemptRef.current, 15000);
      attemptRef.current += 1;
      setState((s) => ({ ...s, connected: false, reconnecting: true }));
      retryTimerRef.current = setTimeout(connect, delay);
    };
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  }, [year, round, sessionType]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  const play = useCallback(() => {
    wasPlayingRef.current = true;
    send("play");
    setState((s) => ({ ...s, playing: true, finished: false }));
  }, [send]);

  const pause = useCallback(() => {
    wasPlayingRef.current = false;
    send("pause");
    setState((s) => ({ ...s, playing: false }));
  }, [send]);

  const setSpeed = useCallback((speed: number) => {
    send(`speed:${speed}`);
    setState((s) => ({ ...s, speed }));
  }, [send]);

  const seek = useCallback((time: number) => {
    send(`seek:${time}`);
    setState((s) => ({ ...s, finished: false }));
  }, [send]);

  const seekToLap = useCallback((lap: number) => {
    send(`seeklap:${lap}`);
    setState((s) => ({ ...s, finished: false }));
  }, [send]);

  const reset = useCallback(() => {
    wasPlayingRef.current = false;
    lastTimestampRef.current = 0;
    send("reset");
    setState((s) => ({ ...s, playing: false, finished: false }));
  }, [send]);

  return { ...state, play, pause, setSpeed, seek, seekToLap, reset };
}
