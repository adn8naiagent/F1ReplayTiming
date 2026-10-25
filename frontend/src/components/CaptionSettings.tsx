"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { authHeaders } from "@/lib/f1tv";

// Team radio caption settings for this server (self-hosted only): the Whisper
// models for replays and live timing, and the optional AI step. Settings in
// .env win and show here as locked. Saving downloads a chosen model that
// isn't on the server yet; captions keep using one that is until it's ready.

interface ModelOption {
  id: string;
  label: string;
  size?: string;
  note: string;
}

interface ModelStatus {
  state: "ready" | "downloading" | "missing" | "error" | "unavailable";
  downloaded_bytes?: number;
  total_bytes?: number | null;
  error?: string;
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
  model_status: Record<string, ModelStatus>;
}

interface Draft {
  whisper_model: string;
  live_whisper_model: string | null;
  ai_enabled: boolean;
  ai_model: string;
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

const draftOf = (d: CaptionSettingsData): Draft => ({
  whisper_model: d.whisper_model,
  live_whisper_model: d.live_whisper_model,
  ai_enabled: d.ai_enabled,
  ai_model: d.ai_model,
});

const selectClass =
  "w-full bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-f1-muted disabled:opacity-50";

function mb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function Locked({ name }: { name: string }) {
  return <p className="mt-1 text-[10px] text-f1-muted">Set by {name} in .env</p>;
}

/** Whether the saved model is on the server, or how far its download has got. */
function Status({ status, saved }: { status?: ModelStatus; saved: boolean }) {
  if (!status || !saved) return null;
  switch (status.state) {
    case "ready":
      return <p className="mt-1 text-[10px] text-green-400">Downloaded</p>;
    case "downloading": {
      const got = status.downloaded_bytes ?? 0;
      const pct = status.total_bytes ? Math.min(99, Math.round((got / status.total_bytes) * 100)) : null;
      return (
        <div className="mt-1">
          <p className="text-[10px] text-yellow-400">
            Downloading… {mb(got)}{status.total_bytes ? ` of ${mb(status.total_bytes)}` : ""}. Captions use the current model until it&apos;s ready.
          </p>
          {pct !== null && (
            <div className="mt-1 h-1 rounded bg-f1-border overflow-hidden">
              <div className="h-full bg-yellow-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      );
    }
    case "error":
      return <p className="mt-1 text-[10px] text-red-400">{status.error ?? "Download failed"}. Captions use the current model.</p>;
    case "missing":
      return <p className="mt-1 text-[10px] text-f1-muted">Not downloaded yet</p>;
    default:
      return null;
  }
}

export default function CaptionSettings() {
  const [data, setData] = useState<CaptionSettingsData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    request("GET").then((d) => { setData(d); setDraft(draftOf(d)); }).catch((e) => setError(e.message));
  }, []);

  // Follow a download's progress
  const downloading = data ? Object.values(data.model_status).some((s) => s.state === "downloading") : false;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => {
      request("GET").then(setData).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [downloading]);

  if (!data || !draft) {
    return error ? <p className="px-2 sm:px-6 pt-3 text-xs text-red-400">{error}</p> : null;
  }

  const saved = draftOf(data);
  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== saved[k]);
  const dirty = changed.length > 0;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k]]));
      const d = await request("PUT", body);
      setData(d);
      setDraft(draftOf(d));
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setSavedAt(null); };
  const whisper = data.whisper_models.find((m) => m.id === draft.whisper_model);
  const liveId = draft.live_whisper_model ?? SAME_AS_REPLAYS;
  const ai = data.ai_models.find((m) => m.id === draft.ai_model);
  const here = (id: string) => data.model_status[id]?.state === "ready";
  const modelLabel = (m: ModelOption) =>
    `${m.label} · ${m.size}${m.id === "small.en" ? " · default" : ""}${here(m.id) ? " · downloaded" : ""}`;

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
          value={draft.whisper_model}
          disabled={busy || data.whisper_model_locked}
          onChange={(e) => set({ whisper_model: e.target.value })}
        >
          {data.whisper_models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
          {!whisper && <option value={draft.whisper_model}>{draft.whisper_model}</option>}
        </select>
        {whisper && <p className="mt-1 text-[10px] text-f1-muted">{whisper.note}</p>}
        <Status status={data.model_status[draft.whisper_model]} saved={draft.whisper_model === saved.whisper_model} />
        {data.whisper_model_locked && <Locked name="TEAM_RADIO_MODEL" />}
      </label>

      {/* Whisper model for live timing */}
      <label className="block">
        <span className="block text-sm text-white mb-1">Caption model for live timing</span>
        <select
          className={selectClass}
          value={liveId}
          disabled={busy || data.live_whisper_model_locked}
          onChange={(e) => set({ live_whisper_model: e.target.value || null })}
        >
          <option value={SAME_AS_REPLAYS}>Same as replays</option>
          {data.whisper_models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
        </select>
        <p className="mt-1 text-[10px] text-f1-muted">
          Live captions have to be ready within your broadcast delay, so a faster model than replays can help on slower machines.
        </p>
        {liveId && <Status status={data.model_status[liveId]} saved={draft.live_whisper_model === saved.live_whisper_model} />}
        {data.live_whisper_model_locked && <Locked name="TEAM_RADIO_LIVE_MODEL" />}
      </label>

      {/* AI step */}
      <div>
        <button
          onClick={() => set({ ai_enabled: !draft.ai_enabled })}
          disabled={busy || !data.ai_available || data.ai_enabled_locked}
          className="w-full flex items-center justify-between py-1 disabled:opacity-50"
        >
          <span className="text-sm text-white">Improve captions with AI</span>
          <div className={`relative w-9 h-5 rounded-full transition-colors ${draft.ai_enabled ? "bg-f1-red" : "bg-f1-border"}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${draft.ai_enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </div>
        </button>
        <p className="text-[10px] text-f1-muted">
          {data.ai_available
            ? "Sends each clip's audio and caption, with the session's drivers and F1 terms, to an AI model through OpenRouter, which listens and corrects it."
            : "Needs OPENROUTER_API_KEY in .env. Sends each clip's audio and caption to an AI model through OpenRouter, which listens and corrects it."}
        </p>
        {data.ai_enabled_locked && <Locked name="TEAM_RADIO_AI" />}
      </div>

      {data.ai_available && draft.ai_enabled && (
        <label className="block">
          <span className="block text-sm text-white mb-1">AI model</span>
          <select
            className={selectClass}
            value={draft.ai_model}
            disabled={busy || data.ai_model_locked}
            onChange={(e) => set({ ai_model: e.target.value })}
          >
            {data.ai_models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!ai && <option value={draft.ai_model}>{draft.ai_model}</option>}
          </select>
          {ai && <p className="mt-1 text-[10px] text-f1-muted">{ai.note}</p>}
          {data.ai_model_locked && <Locked name="TEAM_RADIO_AI_MODEL" />}
        </label>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={!dirty || busy}
          className="px-3 py-1.5 rounded bg-f1-red text-white text-xs font-bold disabled:opacity-40 hover:bg-red-700 transition-colors"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty ? (
          <span className="text-[10px] text-yellow-400">Unsaved changes</span>
        ) : savedAt ? (
          <span className="text-[10px] text-green-400">Saved</span>
        ) : null}
      </div>
      <p className="text-[10px] text-f1-muted">
        Saving downloads a new caption model in the background. Changes apply to live timing and to sessions processed from now on. Reprocess a session to update its existing captions.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
