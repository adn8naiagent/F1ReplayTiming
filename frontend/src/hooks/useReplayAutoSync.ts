"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import type { AutoSyncSettings } from "@/hooks/useAutoSyncSettings";

type AutoSyncState = "disabled" | "idle" | "syncing" | "synced" | "paused" | "error";

interface AutoSyncResponse {
  timestamp: number;
  lap: number;
  confidence: number;
  capture_offset_ms?: number;
}

interface LastSyncSnapshot {
  matchedTimestamp: number;
  capturePerfTime: number;
}

export interface AutoSyncStatus {
  state: AutoSyncState;
  label: string;
  detail: string;
  lastSyncAt: number | null;
}

interface ReplaySnapshot {
  ready: boolean;
  playing: boolean;
  speed: number;
  currentTime: number;
  totalTime: number;
  play: () => void;
  pause: () => void;
  seek: (timestamp: number) => void;
}

interface Params {
  year: number;
  round: number;
  sessionType: string;
  settings: AutoSyncSettings;
  replay: ReplaySnapshot;
}

function formatSignedSeconds(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(1)}s`;
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function useReplayAutoSync({ year, round, sessionType, settings, replay }: Params) {
  const [status, setStatus] = useState<AutoSyncStatus>(() => ({
    state: settings.enabled ? "idle" : "disabled",
    label: settings.enabled ? "Waiting" : "Auto Off",
    detail: settings.enabled ? "Waiting for replay to start" : "Auto sync is disabled",
    lastSyncAt: null,
  }));

  const settingsRef = useRef(settings);
  const replayRef = useRef(replay);
  const inFlightRef = useRef(false);
  const autoPausedRef = useRef(false);
  const lastSyncRef = useRef<LastSyncSnapshot | null>(null);

  settingsRef.current = settings;
  replayRef.current = replay;

  const syncNow = useCallback(async (
    reason: "manual" | "interval" = "manual",
    overrideSettings?: AutoSyncSettings,
  ) => {
    const currentSettings = overrideSettings ?? settingsRef.current;
    const currentReplay = replayRef.current;

    if (inFlightRef.current) return;
    if (!currentSettings.enabled && reason !== "manual") return;
    if (!currentSettings.openwebifUrl.trim()) {
      setStatus({
        state: "error",
        label: "No Box IP",
        detail: "Enter your OpenWebIF IP or URL in the Auto tab",
        lastSyncAt: null,
      });
      return;
    }
    if (!currentReplay.ready) return;
    if (reason === "interval" && !currentReplay.playing && !autoPausedRef.current) return;

    inFlightRef.current = true;
    setStatus((prev) => ({
      ...prev,
      state: "syncing",
      label: "Syncing...",
      detail: "Fetching a fresh OpenWebIF grab",
    }));

    const requestStarted = performance.now();
    const replayAtRequest = {
      playing: currentReplay.playing,
      speed: currentReplay.speed,
      currentTime: currentReplay.currentTime,
      totalTime: currentReplay.totalTime,
    };

    try {
      const resp = await fetch(
        apiUrl(`/api/sessions/${year}/${round}/sync-auto?type=${encodeURIComponent(sessionType)}`),
        {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            openwebif_url: currentSettings.openwebifUrl.trim(),
            username: currentSettings.username.trim(),
            password: currentSettings.password,
          }),
        },
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `Error ${resp.status}`);
      }

      const data: AutoSyncResponse = await resp.json();
      const elapsedSeconds = (performance.now() - requestStarted) / 1000;
      const captureOffsetSeconds = Math.min(elapsedSeconds, (data.capture_offset_ms || 0) / 1000);
      const advanceSinceCapture = replayAtRequest.playing
        ? Math.max(0, elapsedSeconds - captureOffsetSeconds) * replayAtRequest.speed
        : 0;
      const targetTime = Math.max(
        0,
        Math.min(
          replayAtRequest.totalTime || Number.POSITIVE_INFINITY,
          data.timestamp + advanceSinceCapture,
        ),
      );
      const expectedCurrentTime = replayAtRequest.playing
        ? replayAtRequest.currentTime + (elapsedSeconds * replayAtRequest.speed)
        : replayAtRequest.currentTime;
      const driftSeconds = targetTime - expectedCurrentTime;
      const capturePerfTime = requestStarted + (captureOffsetSeconds * 1000);

      let tvPaused = false;
      const previousSync = lastSyncRef.current;
      if (currentSettings.syncPause && previousSync) {
        const wallDeltaSeconds = (capturePerfTime - previousSync.capturePerfTime) / 1000;
        const tvDeltaSeconds = data.timestamp - previousSync.matchedTimestamp;
        if (wallDeltaSeconds >= 2 && tvDeltaSeconds <= Math.max(0.5, wallDeltaSeconds * 0.05)) {
          tvPaused = true;
        }
      }

      if (tvPaused) {
        if (currentReplay.playing) {
          currentReplay.pause();
        }
        autoPausedRef.current = true;
      } else {
        if ((reason === "manual" || Math.abs(driftSeconds) > 0.35) && Math.abs(targetTime - currentReplay.currentTime) > 0.05) {
          currentReplay.seek(targetTime);
        }
        if (autoPausedRef.current && !currentReplay.playing) {
          currentReplay.play();
        }
        autoPausedRef.current = false;
      }

      lastSyncRef.current = {
        matchedTimestamp: data.timestamp,
        capturePerfTime,
      };

      setStatus({
        state: tvPaused ? "paused" : "synced",
        label: tvPaused ? "TV Paused" : Math.abs(driftSeconds) > 0.35 ? `Adjusted ${formatSignedSeconds(driftSeconds)}` : "In Sync",
        detail: `Lap ${data.lap}${data.confidence ? `, ${Math.round(data.confidence)}% confidence` : ""}`,
        lastSyncAt: Date.now(),
      });
    } catch (e: any) {
      setStatus({
        state: "error",
        label: "Sync Failed",
        detail: e?.message || "Failed to sync from OpenWebIF",
        lastSyncAt: Date.now(),
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [round, sessionType, year]);

  const syncPlaybackState = useCallback(async (action: "play" | "pause") => {
    const currentSettings = settingsRef.current;
    if (!currentSettings.enabled || !currentSettings.syncPause || !currentSettings.openwebifUrl.trim()) {
      if (action === "play") {
        autoPausedRef.current = false;
      }
      return;
    }

    if (action === "play") {
      autoPausedRef.current = false;
    }

    try {
      const resp = await fetch(apiUrl("/api/openwebif/playback"), {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          openwebif_url: currentSettings.openwebifUrl.trim(),
          username: currentSettings.username.trim(),
          password: currentSettings.password,
          action,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `Error ${resp.status}`);
      }
    } catch (e: any) {
      setStatus((prev) => ({
        ...prev,
        state: "error",
        label: "TV Control Failed",
        detail: e?.message || `Could not send ${action} to OpenWebIF`,
      }));
    }
  }, []);

  useEffect(() => {
    if (!settings.enabled) {
      autoPausedRef.current = false;
      lastSyncRef.current = null;
      setStatus({
        state: "disabled",
        label: "Auto Off",
        detail: "Auto sync is disabled",
        lastSyncAt: null,
      });
      return;
    }

    if (!settings.openwebifUrl.trim()) {
      setStatus({
        state: "idle",
        label: "Needs Setup",
        detail: "Enter your OpenWebIF IP or URL to start syncing",
        lastSyncAt: null,
      });
      return;
    }

    setStatus((prev) => ({
      ...prev,
      state: prev.state === "error" ? prev.state : "idle",
      label: prev.state === "error" ? prev.label : "Waiting",
      detail: prev.state === "error" ? prev.detail : "Auto sync will run while playback is active",
    }));
  }, [settings.enabled, settings.openwebifUrl]);

  useEffect(() => {
    if (!settings.enabled || !settings.openwebifUrl.trim() || !replay.ready) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await syncNow("interval");
    };

    const intervalMs = Math.max(5, settings.intervalSeconds) * 1000;
    const timer = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [replay.ready, settings.enabled, settings.intervalSeconds, settings.openwebifUrl, syncNow]);

  return {
    status,
    syncNow,
    syncPlaybackState,
  };
}
