"use client";

import { useCallback, useEffect, useState } from "react";

export interface AutoSyncSettings {
  enabled: boolean;
  openwebifUrl: string;
  username: string;
  password: string;
  intervalSeconds: number;
  syncPause: boolean;
}

const ENV_DEFAULT_OPENWEBIF_URL = process.env.NEXT_PUBLIC_OPENWEBIF_URL || "";

export const AUTO_SYNC_DEFAULTS: AutoSyncSettings = {
  enabled: false,
  openwebifUrl: ENV_DEFAULT_OPENWEBIF_URL,
  username: "",
  password: "",
  intervalSeconds: 60,
  syncPause: false,
};

const STORAGE_KEY = "f1replay_auto_sync";

function normaliseAutoSyncSettings(value?: Partial<AutoSyncSettings> | null): AutoSyncSettings {
  const openwebifUrl = typeof value?.openwebifUrl === "string" && value.openwebifUrl.trim()
    ? value.openwebifUrl
    : ENV_DEFAULT_OPENWEBIF_URL;
  const intervalSeconds = Number(value?.intervalSeconds);

  return {
    ...AUTO_SYNC_DEFAULTS,
    ...value,
    openwebifUrl,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds
      : AUTO_SYNC_DEFAULTS.intervalSeconds,
  };
}

function loadAutoSyncSettings(): AutoSyncSettings {
  if (typeof window === "undefined") return AUTO_SYNC_DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normaliseAutoSyncSettings(parsed);
    }
  } catch {}
  return normaliseAutoSyncSettings();
}

export function useAutoSyncSettings() {
  const [settings, setSettings] = useState<AutoSyncSettings>(AUTO_SYNC_DEFAULTS);

  useEffect(() => {
    setSettings(loadAutoSyncSettings());
  }, []);

  const save = useCallback((next: AutoSyncSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  return { settings, save };
}
