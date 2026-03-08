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
  tyre_history: string[];
  gap: string | null;
  has_fastest_lap: boolean;
  flag: "investigation" | "penalty" | null;
  retired: boolean;
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

export interface ReplayFrame {
  timestamp: number;
  lap: number;
  total_laps: number;
  session_type?: string;
  drivers: ReplayDriver[];
  status: string;
  weather?: WeatherData;
  quali_phase?: QualiPhase;
}

export interface QualiPhaseInfo {
  phase: string;
  timestamp: number;
}

interface ReplayState {
  connected: boolean;
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
}

export function useReplaySocket(year: number, round: number, sessionType: string = "R") {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ReplayState>({
    connected: false,
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
  });

  useEffect(() => {
    const url = wsUrl(`/ws/replay/${year}/${round}?type=${sessionType}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onmessage = (event) => {
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
            totalTime: msg.total_time,
            totalLaps: msg.total_laps,
            qualiPhases: msg.quali_phases || [],
          }));
          // Request first frame so cars are visible before play
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("seek:0");
          }
          break;
        case "frame":
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
            },
          }));
          break;
        case "finished":
          setState((s) => ({ ...s, playing: false, finished: true }));
          break;
        case "error":
          setState((s) => ({ ...s, error: msg.message, loading: false }));
          break;
      }
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, error: "WebSocket connection error", loading: false }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    return () => {
      ws.close();
    };
  }, [year, round, sessionType]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  const play = useCallback(() => {
    send("play");
    setState((s) => ({ ...s, playing: true, finished: false }));
  }, [send]);

  const pause = useCallback(() => {
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
    send("reset");
    setState((s) => ({ ...s, playing: false, finished: false }));
  }, [send]);

  return { ...state, play, pause, setSpeed, seek, seekToLap, reset };
}
