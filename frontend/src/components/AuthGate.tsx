"use client";

import { useState, useEffect, FormEvent } from "react";
import { apiUrl } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(apiUrl("/api/auth/status"), { signal: controller.signal })
      .then((res) => res.json())
      .then(async (data) => {
        if (!data.auth_enabled) {
          setAuthenticated(true);
          setChecking(false);
        } else {
          setAuthRequired(true);
          const token = getToken();
          if (token) {
            try {
              const res = await fetch(apiUrl("/api/health"), {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) setAuthenticated(true);
            } catch { /* token invalid or network error */ }
          }
          setChecking(false);
        }
      })
      .catch(() => {
        // Backend unreachable or timeout — let the user through
        // (content will show errors naturally if backend is truly down)
        setAuthenticated(true);
        setChecking(false);
      })
      .finally(() => clearTimeout(timeout));

    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setAuthenticated(true);
      } else if (res.status === 401) {
        setError("Incorrect passphrase");
      } else {
        const detail = await res.text().catch(() => "");
        setError(`Server error (${res.status})${detail ? `: ${detail}` : ""}`);
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-f1-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-f1-dark flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="F1 Replay" className="w-16 h-16 rounded-lg mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white">F1 Replay Timing</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-f1-card border border-f1-border rounded-xl p-6">
          <label htmlFor="passphrase" className="block text-sm font-bold text-f1-muted mb-2">
            Enter passphrase to continue
          </label>
          <div className="relative">
            <input
              id="passphrase"
              type={showPassphrase ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 pr-10 bg-f1-dark border border-f1-border rounded text-white text-sm focus:outline-none focus:border-f1-red transition-colors"
              placeholder="Passphrase"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-f1-muted hover:text-white transition-colors"
              tabIndex={-1}
            >
              {showPassphrase ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          {error && (
            <p className="text-red-400 text-xs mt-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !passphrase}
            className="w-full mt-4 px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
