"use client";

import { useState, useEffect, FormEvent } from "react";
import { apiUrl } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/auth/status"))
      .then((res) => res.json())
      .then((data) => {
        if (!data.auth_enabled) {
          setAuthenticated(true);
        } else {
          setAuthRequired(true);
          // Check if we have a cached token that still works
          const token = getToken();
          if (token) {
            fetch(apiUrl("/api/health"), {
              headers: { Authorization: `Bearer ${token}` },
            }).then((res) => {
              if (res.ok) {
                setAuthenticated(true);
              }
              setChecking(false);
            }).catch(() => setChecking(false));
          } else {
            setChecking(false);
          }
        }
      })
      .catch(() => {
        // Can't reach backend — assume auth is required so we don't bypass it
        setAuthRequired(true);
      })
      .finally(() => {
        if (!authRequired) setChecking(false);
      });
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
      } else {
        setError("Incorrect passphrase");
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
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 bg-f1-dark border border-f1-border rounded text-white text-sm focus:outline-none focus:border-f1-red transition-colors"
            placeholder="Passphrase"
          />
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
