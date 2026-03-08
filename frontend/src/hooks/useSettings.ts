"use client";

import { useState, useEffect, useCallback } from "react";

export interface ReplaySettings {
  showLeaderboard: boolean;
  showTeamAbbr: boolean;
  showTyreAge: boolean;
  showTyreType: boolean;
  showPitStops: boolean;
  showTyreHistory: boolean;
  showGridChange: boolean;
  showGapToLeader: boolean;
  showSessionTime: boolean;
  showDriverNames: boolean;
  showWeather: boolean;
  showAirTemp: boolean;
  showTrackTemp: boolean;
  showHumidity: boolean;
  showWind: boolean;
  showRainfall: boolean;
  showPitPrediction: boolean;
}

const STORAGE_KEY = "f1replay_settings";

export const DEFAULTS: ReplaySettings = {
  showLeaderboard: true,
  showTeamAbbr: false,
  showTyreAge: true,
  showTyreType: true,
  showPitStops: true,
  showTyreHistory: true,
  showGridChange: true,
  showGapToLeader: true,
  showSessionTime: false,
  showDriverNames: true,
  showWeather: true,
  showAirTemp: true,
  showTrackTemp: true,
  showHumidity: true,
  showWind: true,
  showRainfall: true,
  showPitPrediction: true,
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
