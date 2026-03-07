"use client";

import { useState, useEffect, useCallback } from "react";

export interface ReplaySettings {
  showLeaderboard: boolean;
  showTyreAge: boolean;
  showTyreType: boolean;
  showPitStops: boolean;
  showGridChange: boolean;
  showGapToLeader: boolean;
  showSessionTime: boolean;
  showDriverNames: boolean;
}

const STORAGE_KEY = "f1replay_settings";

const DEFAULTS: ReplaySettings = {
  showLeaderboard: true,
  showTyreAge: true,
  showTyreType: true,
  showPitStops: true,
  showGridChange: true,
  showGapToLeader: true,
  showSessionTime: false,
  showDriverNames: true,
};

function loadSettings(): ReplaySettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return DEFAULTS;
}

export function useSettings() {
  const [settings, setSettings] = useState<ReplaySettings>(DEFAULTS);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = useCallback((key: keyof ReplaySettings, value: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return { settings, update };
}
