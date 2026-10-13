"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "./api";

// Runtime settings from the backend. The frontend is a static build, so
// anything that differs between deployments has to come from here.
export interface AppConfig {
  public_mode: boolean;
  replay_player: "static" | "websocket";
  photo_sync: boolean;
  live: boolean;
}

// Used if the backend predates /api/config: behave as before.
const FALLBACK: AppConfig = {
  public_mode: false,
  replay_player: "websocket",
  photo_sync: true,
  live: true,
};

export const REPO_URL = "https://github.com/adn8naiagent/F1ReplayTiming";
export const KOFI_URL = "https://ko-fi.com/addevaccount";

let configPromise: Promise<AppConfig> | null = null;

export function loadConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = fetch(apiUrl("/api/config"))
      .then((res) => (res.ok ? res.json() : FALLBACK))
      .then((data) => ({ ...FALLBACK, ...data }))
      .catch(() => {
        configPromise = null; // try again next time
        return FALLBACK;
      });
  }
  return configPromise;
}

/** null until loaded, so admin-only controls never flash before public mode is known. */
export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

export function reportProblemUrl(details?: Record<string, string | number | undefined>): string {
  const lines = Object.entries(details || {})
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `- ${k}: ${v}`);
  if (typeof navigator !== "undefined") lines.push(`- Browser: ${navigator.userAgent}`);
  const params = new URLSearchParams({ template: "bug_report.yml" });
  if (lines.length) params.set("context", lines.join("\n"));
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
