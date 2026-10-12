"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { apiUrl, API_URL } from "@/lib/api";
import { getToken, setToken, clearToken } from "@/lib/auth";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const checkAuth = useCallback(() => {
    setChecking(true);
    setConnectionError(false);

    const url = apiUrl("/api/auth/status");
    console.log(`[AuthGate] Checking auth status at ${url}`);

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          console.error(`[AuthGate] Auth status returned ${res.status}`);
          throw new Error(`Backend returned ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        console.log(`[AuthGate] Auth enabled: ${data.auth_enabled}`);
        if (!data.auth_enabled) {
          setAuthenticated(true);
          setChecking(false);
        } else {
          setAuthRequired(true);
          // Check if we have a cached token that still works
          const token = getToken();
          if (token) {
            fetch(apiUrl("/api/auth/verify"), {
              headers: { Authorization: `Bearer ${token}` },
            }).then((res) => {
              if (res.ok) {
                console.log("[AuthGate] Cached token is valid");
                setAuthenticated(true);
              } else {
                console.log("[AuthGate] Cached token is invalid, clearing");
                clearToken();
              }
              setChecking(false);
            }).catch(() => {
              console.error("[AuthGate] Failed to validate cached token");
              setChecking(false);
            });
          } else {
            setChecking(false);
          }
        }
      })
      .catch((err) => {
        console.error(`[AuthGate] Cannot connect to backend at ${API_URL}:`, err.message);
        setConnectionError(true);
        setChecking(false);
      });
  }, []);

  useEffect(() => {
    // Public sites have no passphrase; the backend marks their pages so the
    // app opens without waiting on (or failing) an auth check.
    if ((window as { __PUBLIC_MODE__?: boolean }).__PUBLIC_MODE__) {
      setAuthenticated(true);
      setChecking(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

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

  if (connectionError) {
    return (
      <div className="min-h-screen bg-f1-dark flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="F1 Replay" className="w-16 h-16 rounded-lg mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white">F1 Replay Timing</h1>
          </div>

          <div className="bg-f1-card border border-f1-border rounded-xl p-6">
            <h2 className="text-sm font-bold text-red-400 mb-3">Cannot connect to backend</h2>
            <p className="text-sm text-f1-muted mb-3">
              The frontend failed to reach the API server at:
            </p>
            <code className="block text-xs text-white bg-f1-dark border border-f1-border rounded px-3 py-2 mb-4 break-all">
              {API_URL || (typeof window !== "undefined" ? window.location.origin : "(same origin)")}
            </code>
            <div className="text-xs text-f1-muted space-y-2">
              <p>Common causes:</p>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>The backend container is still starting up</li>
                <li>
                  <code className="text-white">NEXT_PUBLIC_API_URL</code> in your
                  docker-compose.yml is set to a URL that isn&apos;t reachable from
                  your browser
                </li>
                <li>
                  If behind a reverse proxy, this URL must be the address your browser
                  uses to reach the backend, not an internal Docker address
                </li>
              </ul>
            </div>
            <button
              onClick={checkAuth}
              className="w-full mt-5 px-4 py-2 bg-f1-red text-white text-sm font-bold rounded hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
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
