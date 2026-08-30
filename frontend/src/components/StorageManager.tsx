"use client";

import { useState, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

interface StoredSession {
  year: number;
  round: number;
  type: string;
  event_name: string;
  date_utc: string | null;
  size_bytes: number;
}

interface Retention {
  enabled: boolean;
  amount: number;
  unit: Unit;
  last_run?: string | null;
  last_freed_bytes?: number | null;
  last_deleted?: number | null;
}

interface StorageResponse {
  total_bytes: number;
  session_count: number;
  sessions: StoredSession[];
  retention: Retention;
}

interface SweepResult {
  count: number;
  freed_bytes: number;
  sessions?: StoredSession[];
}

type Unit = "weeks" | "months";

function formatSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 KB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function authFetch(path: string, init?: RequestInit) {
  const token = getToken();
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function StorageManager({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [enabled, setEnabled] = useState(false);
  // Held as a string so the field can be cleared and overtyped; parsed on use.
  const [amount, setAmount] = useState("6");
  const [unit, setUnit] = useState<Unit>("months");
  const amountNum = Math.max(1, parseInt(amount, 10) || 1);
  const unitLabel = amountNum === 1 ? unit.slice(0, -1) : unit;

  const [confirm, setConfirm] = useState<SweepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/storage");
      if (!res.ok) throw new Error();
      const body: StorageResponse = await res.json();
      setData(body);
      setEnabled(body.retention.enabled);
      setAmount(String(body.retention.amount));
      setUnit(body.retention.unit);
    } catch {
      setError("Could not read storage usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saved = data?.retention;
  const dirty =
    !!saved &&
    (enabled !== saved.enabled || amountNum !== saved.amount || unit !== saved.unit);

  // A pending confirmation is only valid for the values it was taken against.
  useEffect(() => {
    setConfirm(null);
    setResult(null);
  }, [enabled, amount, unit]);

  const query = `enabled=${enabled}&amount=${amountNum}&unit=${unit}`;

  async function requestSave() {
    setBusy(true);
    setError(null);
    try {
      // Turning it off deletes nothing, so skip straight to saving.
      if (!enabled) {
        const res = await authFetch(`/api/storage/retention?${query}`, { method: "PUT" });
        if (!res.ok) throw new Error();
        setResult("Automatic deletion turned off.");
        await load();
        return;
      }
      const res = await authFetch(`/api/storage/retention?${query}&dry_run=true`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error();
      const body: SweepResult = await res.json();
      if (body.count === 0) {
        // Nothing to remove today — just save the policy.
        const apply = await authFetch(`/api/storage/retention?${query}`, { method: "PUT" });
        if (!apply.ok) throw new Error();
        setResult("Saved. Nothing stored is that old yet.");
        await load();
        return;
      }
      setConfirm(body);
    } catch {
      setError("Could not save the retention setting.");
    } finally {
      setBusy(false);
    }
  }

  async function applySave() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/storage/retention?${query}`, { method: "PUT" });
      if (!res.ok) throw new Error();
      const body: SweepResult = await res.json();
      setConfirm(null);
      setResult(
        `Deleted ${body.count} session${body.count === 1 ? "" : "s"}, freeing ${formatSize(body.freed_bytes)}.`,
      );
      await load();
    } catch {
      setError("Failed to apply the retention setting.");
    } finally {
      setBusy(false);
    }
  }

  const lastRun = formatWhen(saved?.last_run);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-f1-card border border-f1-border rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="p-6 pb-4 border-b border-f1-border">
          <h3 className="text-white font-bold text-lg">Storage</h3>
          {loading ? (
            <p className="text-f1-muted text-sm mt-1">Reading usage…</p>
          ) : (
            <p className="text-f1-muted text-sm mt-1">
              {data?.session_count || 0} session{data?.session_count === 1 ? "" : "s"} stored
              {" · "}
              <span className="text-white font-bold">{formatSize(data?.total_bytes)}</span>
            </p>
          )}
        </div>

        {/* Retention policy */}
        <div className="p-6 py-4 border-b border-f1-border overflow-y-auto min-h-0">
          <button
            onClick={() => setEnabled(!enabled)}
            className="flex items-center gap-3 w-full text-left mb-3"
          >
            <div className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${enabled ? "bg-f1-red" : "bg-f1-border"}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </div>
            <span className="text-white text-sm font-bold">
              Automatically delete old sessions
            </span>
          </button>

          <div className={enabled ? "" : "opacity-40 pointer-events-none"}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-f1-muted text-sm">Delete sessions older than</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                onFocus={(e) => e.target.select()}
                onBlur={() => { if (!amount) setAmount("1"); }}
                aria-label="Age threshold"
                className="w-14 px-2 py-1.5 bg-f1-dark border border-f1-border rounded text-white text-sm text-center"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="px-2 py-1.5 bg-f1-dark border border-f1-border rounded text-white text-sm"
              >
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
            </div>
            <p className="text-f1-muted text-xs mt-2">
              Checked daily. Open a session to download it again.
            </p>
          </div>

          {saved?.enabled && lastRun && !dirty && (
            <p className="text-f1-muted text-xs mt-2">
              Last run {lastRun}
              {saved.last_deleted
                ? ` — removed ${saved.last_deleted} session${saved.last_deleted === 1 ? "" : "s"}, freeing ${formatSize(saved.last_freed_bytes)}.`
                : " — nothing was old enough to remove."}
            </p>
          )}

          {dirty && !confirm && (
            <button
              onClick={requestSave}
              disabled={busy}
              className="mt-3 px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {busy ? "Checking…" : "Save"}
            </button>
          )}

          {confirm && (
            <div className="mt-3 p-3 bg-f1-dark border border-f1-border rounded">
              <p className="text-white text-sm mb-2">
                Deletes <span className="font-bold">{confirm.count}</span> session
                {confirm.count === 1 ? "" : "s"} now, freeing{" "}
                <span className="font-bold">{formatSize(confirm.freed_bytes)}</span>. Runs
                daily for sessions older than{" "}
                <span className="font-bold">{amountNum} {unitLabel}</span>.
              </p>

              {!!confirm.sessions?.length && (
                <div className="max-h-40 overflow-y-auto mb-3 border border-f1-border rounded">
                  {confirm.sessions.map((s) => (
                    <div
                      key={`${s.year}_${s.round}_${s.type}`}
                      className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs border-b border-f1-border/40 last:border-0"
                    >
                      <span className="text-white truncate">
                        {s.event_name}
                        <span className="text-f1-muted ml-1.5">{s.type}</span>
                      </span>
                      <span className="text-f1-muted flex-shrink-0 whitespace-nowrap">
                        {formatDate(s.date_utc)} · {formatSize(s.size_bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirm(null)}
                  className="px-3 py-1.5 bg-f1-border text-white text-xs font-bold rounded hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applySave}
                  disabled={busy}
                  className="px-3 py-1.5 bg-f1-red text-white text-xs font-bold rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Delete and save"}
                </button>
              </div>
            </div>
          )}

          {result && <p className="text-green-400 text-sm mt-2">{result}</p>}
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        <div className="p-6 pt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-f1-border text-white text-sm font-bold rounded hover:bg-f1-red transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
