"use client";

import { useState, useRef } from "react";
import { getToken } from "@/lib/auth";

interface Props {
  year: number;
  round: number;
  sessionType: string;
  onSync: (timestamp: number) => void;
  onClose: () => void;
}

interface SyncResult {
  timestamp: number;
  lap: number;
  confidence: number;
  extracted: {
    lap: number;
    drivers: Array<{
      position: number;
      abbr: string;
      gap: string | null;
      tyre: string | null;
    }>;
  };
}

export default function SyncPhoto({
  year,
  round,
  sessionType,
  onSync,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"photo" | "manual">("photo");
  const [step, setStep] = useState<"instructions" | "capture" | "processing" | "result">("instructions");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [manualLap, setManualLap] = useState("");
  const [manualP1, setManualP1] = useState({ abbr: "", gap: "" });
  const [manualP2, setManualP2] = useState({ abbr: "", gap: "" });
  const [manualP3, setManualP3] = useState({ abbr: "", gap: "" });
  const [manualGapMode, setManualGapMode] = useState<"leader" | "interval">("interval");
  const [manualProcessing, setManualProcessing] = useState(false);

  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB backend limit

  async function handleFile(file: File) {
    setStep("processing");
    setError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Image is too large (max 20MB).");
      setStep("capture");
      return;
    }

    const formData = new FormData();
    formData.append("photo", file, file.name);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const headers: HeadersInit = {};
      const token = getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const resp = await fetch(
        `${API_URL}/api/sessions/${year}/${round}/sync-photo?type=${sessionType}`,
        { method: "POST", body: formData, headers },
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `Error ${resp.status}`);
      }

      const data: SyncResult = await resp.json();
      setResult(data);
      setStep("result");
    } catch (e: any) {
      setError(e.message || "Failed to sync");
      setStep("capture");
    }
  }

  async function handleManualSync() {
    const lap = parseInt(manualLap);
    if (!lap || lap < 1) {
      setError("Enter a valid lap number");
      return;
    }

    const p2Raw = manualP2.gap.trim() ? parseFloat(manualP2.gap.trim().replace(/^\+/, "")) : null;
    const p3Raw = manualP3.gap.trim() ? parseFloat(manualP3.gap.trim().replace(/^\+/, "")) : null;

    // Convert interval to gap-to-leader if needed
    const p2Gap = p2Raw != null ? p2Raw : null;
    const p3Gap = p3Raw != null
      ? (manualGapMode === "interval" && p2Raw != null ? p2Raw + p3Raw : p3Raw)
      : null;

    const drivers: Array<{ position: number; abbr: string; gap: string | null }> = [];
    if (manualP1.abbr.trim()) {
      drivers.push({ position: 1, abbr: manualP1.abbr.trim().toUpperCase(), gap: null });
    }
    if (manualP2.abbr.trim()) {
      drivers.push({
        position: 2,
        abbr: manualP2.abbr.trim().toUpperCase(),
        gap: p2Gap != null ? `+${p2Gap}` : null,
      });
    }
    if (manualP3.abbr.trim()) {
      drivers.push({
        position: 3,
        abbr: manualP3.abbr.trim().toUpperCase(),
        gap: p3Gap != null ? `+${p3Gap}` : null,
      });
    }

    if (drivers.length === 0) {
      setError("Enter at least one driver");
      return;
    }

    setManualProcessing(true);
    setError(null);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const manualHeaders: HeadersInit = { "Content-Type": "application/json" };
      const manualToken = getToken();
      if (manualToken) manualHeaders["Authorization"] = `Bearer ${manualToken}`;
      const resp = await fetch(
        `${API_URL}/api/sessions/${year}/${round}/sync-manual?type=${sessionType}`,
        {
          method: "POST",
          headers: manualHeaders,
          body: JSON.stringify({ lap, drivers }),
        },
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `Error ${resp.status}`);
      }

      const data: SyncResult = await resp.json();
      setResult(data);
      setTab("photo"); // reuse result view
      setStep("result");
    } catch (e: any) {
      setError(e.message || "Failed to sync");
    } finally {
      setManualProcessing(false);
    }
  }

  function handleCapture() {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  }

  function handleUpload() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function resetToStart() {
    setStep("instructions");
    setResult(null);
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-f1-card border border-f1-border rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-f1-border">
          <h2 className="text-lg font-bold text-white">Sync with TV Replay</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {step !== "result" && (
          <div className="flex border-b border-f1-border">
            <button
              onClick={() => { setTab("photo"); resetToStart(); }}
              className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                tab === "photo"
                  ? "text-white border-b-2 border-f1-red"
                  : "text-f1-muted hover:text-white"
              }`}
            >
              Photo
            </button>
            <button
              onClick={() => { setTab("manual"); resetToStart(); }}
              className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                tab === "manual"
                  ? "text-white border-b-2 border-f1-red"
                  : "text-f1-muted hover:text-white"
              }`}
            >
              Manual Entry
            </button>
          </div>
        )}

        <div className="px-6 py-5">
          {/* ===== PHOTO TAB ===== */}
          {tab === "photo" && (
            <>
              {/* Instructions */}
              {step === "instructions" && (
                <div className="space-y-4">
                  <p className="text-sm text-f1-muted leading-relaxed">
                    Take a photo of the leaderboard on your TV to sync the replay
                    to the exact moment.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-f1-red flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        1
                      </span>
                      <p className="text-sm text-white">
                        Pause the TV on a frame where the leaderboard is clearly visible
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-f1-red flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        2
                      </span>
                      <p className="text-sm text-white">
                        Make sure the lap number and at least the top 5 drivers with
                        their gap times are visible
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-f1-red flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        3
                      </span>
                      <p className="text-sm text-white">
                        Take a photo and we will match it to the exact moment in the race
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setStep("capture")}
                    className="w-full py-3 bg-f1-red hover:bg-red-700 rounded-lg text-white font-bold text-sm transition-colors"
                  >
                    Continue
                  </button>
                </div>
              )}

              {/* Capture */}
              {step === "capture" && (
                <div className="space-y-4">
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleCapture}
                    className="w-full py-4 bg-f1-red hover:bg-red-700 rounded-lg text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
                    Take Photo
                  </button>

                  <button
                    onClick={handleUpload}
                    className="w-full py-3 bg-f1-border hover:bg-white/20 rounded-lg text-f1-muted hover:text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload Image
                  </button>

                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleInputChange}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    className="hidden"
                    onChange={handleInputChange}
                  />

                  <button
                    onClick={() => setStep("instructions")}
                    className="w-full text-sm text-f1-muted hover:text-white transition-colors"
                  >
                    Back
                  </button>
                </div>
              )}

              {/* Processing */}
              {step === "processing" && (
                <div className="text-center py-6">
                  <div className="inline-block w-10 h-10 border-3 border-f1-muted border-t-f1-red rounded-full animate-spin mb-4" />
                  <p className="text-sm text-white font-bold">Analysing leaderboard...</p>
                  <p className="text-xs text-f1-muted mt-1">
                    Extracting positions and gap times
                  </p>
                </div>
              )}

              {/* Result */}
              {step === "result" && result && (
                <div className="space-y-4">
                  <div className="bg-white/5 rounded-lg px-4 py-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-f1-muted">Matched to</span>
                      <span className="text-sm font-extrabold text-white">
                        Lap {result.lap} - {formatTime(result.timestamp)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-f1-muted">Detected</span>
                      <span className="text-sm text-white">
                        {result.extracted.drivers.length} drivers, Lap{" "}
                        {result.extracted.lap}
                      </span>
                    </div>
                  </div>

                  {/* Extracted drivers preview */}
                  <div className="space-y-1">
                    {result.extracted.drivers.slice(0, 5).map((d) => (
                      <div
                        key={d.position}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="w-5 text-right font-bold text-f1-muted">
                          P{d.position}
                        </span>
                        <span className="font-extrabold text-white">{d.abbr}</span>
                        <span className="text-f1-muted ml-auto">
                          {d.gap || "Leader"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const ts = result!.timestamp;
                      onSync(ts);
                      onClose();
                    }}
                    className="w-full py-3 bg-f1-red hover:bg-red-700 rounded-lg text-white font-bold text-sm transition-colors cursor-pointer relative z-[60]"
                  >
                    Sync to this moment
                  </button>

                  <button
                    onClick={() => {
                      setResult(null);
                      setStep("instructions");
                    }}
                    className="w-full text-sm text-f1-muted hover:text-white transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          )}

          {/* ===== MANUAL TAB ===== */}
          {tab === "manual" && step !== "result" && (
            <div className="space-y-4">
              <p className="text-sm text-f1-muted leading-relaxed">
                Enter the lap number and the top drivers with their gaps as shown on the TV leaderboard.
              </p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Lap number */}
              <div>
                <label className="text-xs font-bold text-f1-muted uppercase tracking-wider block mb-1.5">
                  Lap Number
                </label>
                <input
                  type="number"
                  min="1"
                  value={manualLap}
                  onChange={(e) => setManualLap(e.target.value)}
                  placeholder="e.g. 23"
                  className="w-full bg-f1-dark border border-f1-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red"
                />
              </div>

              {/* Gap mode toggle */}
              <div>
                <label className="text-xs font-bold text-f1-muted uppercase tracking-wider block mb-1.5">
                  Broadcast showing
                </label>
                <div className="flex border border-f1-border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setManualGapMode("interval")}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                      manualGapMode === "interval" ? "bg-f1-red text-white" : "bg-f1-dark text-f1-muted hover:text-white"
                    }`}
                  >
                    Interval
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualGapMode("leader")}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                      manualGapMode === "leader" ? "bg-f1-red text-white" : "bg-f1-dark text-f1-muted hover:text-white"
                    }`}
                  >
                    Leader
                  </button>
                </div>
              </div>

              {/* Driver entries */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-f1-muted uppercase tracking-wider block">
                  Drivers
                </label>

                {/* P1 */}
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-f1-red flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    1
                  </span>
                  <input
                    type="text"
                    maxLength={3}
                    value={manualP1.abbr}
                    onChange={(e) => setManualP1({ ...manualP1, abbr: e.target.value })}
                    placeholder="VER"
                    className="w-20 bg-f1-dark border border-f1-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red uppercase"
                  />
                  <span className="text-xs text-f1-muted flex-1 text-right">{manualGapMode === "interval" ? "Interval" : "Leader"}</span>
                </div>

                {/* P2 */}
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded bg-f1-border flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    2
                  </span>
                  <input
                    type="text"
                    maxLength={3}
                    value={manualP2.abbr}
                    onChange={(e) => setManualP2({ ...manualP2, abbr: e.target.value })}
                    placeholder="NOR"
                    className="w-20 bg-f1-dark border border-f1-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red uppercase"
                  />
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-f1-muted">+</span>
                    <input
                      type="text"
                      value={manualP2.gap}
                      onChange={(e) => setManualP2({ ...manualP2, gap: e.target.value })}
                      placeholder="0.6"
                      className="w-full bg-f1-dark border border-f1-border rounded-lg pl-6 pr-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red"
                    />
                  </div>
                </div>

                {/* P3 */}
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded bg-f1-border flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    3
                  </span>
                  <input
                    type="text"
                    maxLength={3}
                    value={manualP3.abbr}
                    onChange={(e) => setManualP3({ ...manualP3, abbr: e.target.value })}
                    placeholder="LEC"
                    className="w-20 bg-f1-dark border border-f1-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red uppercase"
                  />
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-f1-muted">+</span>
                    <input
                      type="text"
                      value={manualP3.gap}
                      onChange={(e) => setManualP3({ ...manualP3, gap: e.target.value })}
                      placeholder="1.1"
                      className="w-full bg-f1-dark border border-f1-border rounded-lg pl-6 pr-3 py-2 text-sm text-white placeholder:text-f1-muted/50 focus:outline-none focus:border-f1-red"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleManualSync}
                disabled={manualProcessing}
                className="w-full py-3 bg-f1-red hover:bg-red-700 rounded-lg text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {manualProcessing ? "Matching..." : "Find Moment"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
