"use client";

import { useEffect, useState } from "react";
import { f1tv, type F1TVStatus } from "@/lib/f1tv";

function formatExpiry(exp: number | null | undefined): string | null {
  if (!exp) return null;
  const date = new Date(exp * 1000);
  const days = Math.round((exp * 1000 - Date.now()) / 86400000);
  const when = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return days < 0 ? `Expired ${when}` : `Expires ${when} (${days} day${days === 1 ? "" : "s"})`;
}

export default function F1TVAccount() {
  const [status, setStatus] = useState<F1TVStatus | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    f1tv.status().then(setStatus).catch((e) => setError(e.message));
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await f1tv.signIn(value));
      setValue("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      setStatus(await f1tv.signOut());
    } finally {
      setBusy(false);
    }
  }

  const expiry = formatExpiry(status?.expires_at);

  return (
    <div className="px-2 sm:px-6 py-2 space-y-3">
      {status?.signed_in ? (
        <>
          <div className="space-y-1">
            <p className="text-sm text-white">
              Signed in{status.product ? ` · ${status.product}` : ""}
              {status.subscription_status ? ` · ${status.subscription_status}` : ""}
            </p>
            {expiry && <p className="text-xs text-f1-muted">{expiry}</p>}
            {status.error && <p className="text-xs text-orange-400">{status.error}</p>}
          </div>
          <p className="text-xs text-f1-muted leading-relaxed">
            Live timing uses your subscription for car positions and telemetry. Turn on Broadcast in a replay to
            watch the F1 TV feed alongside the timing.
          </p>
          <button
            onClick={signOut}
            disabled={busy}
            className="px-4 py-2 bg-f1-border text-white text-sm font-bold rounded hover:bg-f1-muted/40 transition-colors disabled:opacity-50"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-f1-muted leading-relaxed">
            Sign in with your own F1 TV subscription for live car positions, live telemetry and the F1 TV broadcast.
            Your token stays on this server.
          </p>
          <ol className="text-xs text-f1-muted leading-relaxed list-decimal pl-4 space-y-1">
            <li>Sign in at f1tv.formula1.com in another tab.</li>
            <li>Open developer tools, go to Application (Storage in Firefox), then Cookies, then formula1.com.</li>
            <li>Copy the value of the <span className="text-white font-mono">loginSession</span> cookie and paste it below.</li>
          </ol>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            placeholder="loginSession cookie value"
            className="w-full bg-f1-dark border border-f1-border rounded px-2 py-1.5 text-xs text-white font-mono resize-none focus:outline-none focus:border-f1-muted"
          />
          <button
            onClick={signIn}
            disabled={busy || !value.trim()}
            className="px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
