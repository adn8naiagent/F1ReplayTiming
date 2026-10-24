"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { authHeaders } from "@/lib/f1tv";

// Team radio caption settings for this server (self-hosted only): the Whisper
// models for replays and live timing, and the optional AI step. Settings in
// .env win and show here as locked.

interface ModelOption {
  id: string;
  label: string;
  size?: string;
  note: string;
}

interface CaptionSettingsData {
  whisper_model: string;
  whisper_model_locked: boolean;
  whisper_models: ModelOption[];
  live_whisper_model: string | null; // null: the same as replays
  live_whisper_model_locked: boolean;
  ai_available: boolean;
  ai_enabled: boolean;
  ai_enabled_locked: boolean;
  ai_model: string;
  ai_model_locked: boolean;
  ai_models: ModelOption[];
}

const SAME_AS_REPLAYS = "";

async function request(method: "GET" | "PUT", body?: object): Promise<CaptionSettingsData> {
  const res = await fetch(apiUrl("/api/captions/settings"), {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
  return data;
}

const selectClass =
  "w-full bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-f1-muted disabled:opacity-50";

function Locked({ name }: { name: string }) {
  return <p className="mt-1 text-[10px] text-f1-muted">Set by {name} in .env</p>;
}

export default function CaptionSettings() {
  const [data, setData] = useState<CaptionSettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request("GET").then(setData).catch((e) => setError(e.message));
  }, []);

  async function save(body: object) {
    setBusy(true);
    setError(null);
    try {
      setData(await request("PUT", body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? <p className="px-2 sm:px-6 pt-3 text-xs text-red-400">{error}</p> : null;
  }

  const whisper = data.whisper_models.find((m) => m.id === data.whisper_model);
  const liveId = data.live_whisper_model ?? SAME_AS_REPLAYS;
  const live = data.whisper_models.find((m) => m.id === liveId);
  const ai = data.ai_models.find((m) => m.id === data.ai_model);
  const modelLabel = (m: ModelOption) => `${m.label} · ${m.size}${m.id === "small.en" ? " · default" : ""}`;

  return (
    <div className="px-2 sm:px-6 pt-4 mt-3 border-t border-f1-border space-y-3">
      <div>
        <p className="text-xs font-bold text-f1-muted uppercase tracking-wider">Captions on this server</p>
        <p className="text-[10px] text-f1-muted mt-0.5">For everyone using this server. Larger models are more accurate but slower and download more.</p>
      </div>

      {/* Whisper model for replays */}
      <label className="block">
        <span className="block text-sm text-white mb-1">Caption model for replays</span>
        <select
          className={selectClass}
          value={data.whisper_model}
          disabled={busy || data.whisper_model_locked}
          onChange={(e) => save({ whisper_model: e.target.value })}
        >
          {data.whisper_models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
          {!whisper && <option value={data.whisper_model}>{data.whisper_model}</option>}
        </select>
        {whisper && <p className="mt-1 text-[10px] text-f1-muted">{whisper.note}</p>}
        {data.whisper_model_locked && <Locked name="TEAM_RADIO_MODEL" />}
      </label>

      {/* Whisper model for live timing */}
      <label className="block">
        <span className="block text-sm text-white mb-1">Caption model for live timing</span>
        <select
          className={selectClass}
          value={liveId}
          disabled={busy || data.live_whisper_model_locked}
          onChange={(e) => save({ live_whisper_model: e.target.value || null })}
        >
          <option value={SAME_AS_REPLAYS}>Same as replays</option>
          {data.whisper_models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
          {liveId && !live && <option value={liveId}>{liveId}</option>}
        </select>
        <p className="mt-1 text-[10px] text-f1-muted">
          Live captions have to be ready within your broadcast delay, so a faster model than replays can help on slower machines.
        </p>
        {data.live_whisper_model_locked && <Locked name="TEAM_RADIO_LIVE_MODEL" />}
      </label>

      {/* AI step */}
      <div>
        <button
          onClick={() => save({ ai_enabled: !data.ai_enabled })}
          disabled={busy || !data.ai_available || data.ai_enabled_locked}
          className="w-full flex items-center justify-between py-1 disabled:opacity-50"
        >
          <span className="text-sm text-white">Improve captions with AI</span>
          <div className={`relative w-9 h-5 rounded-full transition-colors ${data.ai_enabled ? "bg-f1-red" : "bg-f1-border"}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${data.ai_enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </div>
        </button>
        <p className="text-[10px] text-f1-muted">
          {data.ai_available
            ? "Sends each clip's audio and caption, with the session's drivers and F1 terms, to an AI model through OpenRouter, which listens and corrects it."
            : "Needs OPENROUTER_API_KEY in .env. Sends each clip's audio and caption to an AI model through OpenRouter, which listens and corrects it."}
        </p>
        {data.ai_enabled_locked && <Locked name="TEAM_RADIO_AI" />}
      </div>

      {data.ai_available && data.ai_enabled && (
        <label className="block">
          <span className="block text-sm text-white mb-1">AI model</span>
          <select
            className={selectClass}
            value={data.ai_model}
            disabled={busy || data.ai_model_locked}
            onChange={(e) => save({ ai_model: e.target.value })}
          >
            {data.ai_models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!ai && <option value={data.ai_model}>{data.ai_model}</option>}
          </select>
          {ai && <p className="mt-1 text-[10px] text-f1-muted">{ai.note}</p>}
          {data.ai_model_locked && <Locked name="TEAM_RADIO_AI_MODEL" />}
        </label>
      )}

      <p className="text-[10px] text-f1-muted">
        Changes apply to live timing and to sessions processed from now on. Reprocess a session to update its captions.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
