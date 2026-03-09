"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "@/lib/api";
import { ReplayDriver, WeatherData, ReplayFrame } from "@/hooks/useReplaySocket";

interface LiveSessionInfo {
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

interface UseLiveTimingResult {
  connected: boolean;
  sessionInfo: LiveSessionInfo | null;
  frame: ReplayFrame | null;
  error: string | null;
}

export function useLiveTiming(): UseLiveTimingResult {
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<LiveSessionInfo | null>(null);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = wsUrl("/api/live/ws");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "session_info") {
          setSessionInfo(msg.data);
        } else if (msg.type === "frame") {
          setFrame(msg.data);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 5 seconds
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => {
      setError("Connection error");
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, sessionInfo, frame, error };
}
