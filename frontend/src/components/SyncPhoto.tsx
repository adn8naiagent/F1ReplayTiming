"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api";

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

const isDev = process.env.NODE_ENV === "development";

export default function SyncPhoto({
  year,
  round,
  sessionType,
  onSync,
  onClose,
}: Props) {
  const [step, setStep] = useState<"instructions" | "capture" | "processing" | "result">("instructions");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function compressImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let { width, height } = img;
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
          "image/jpeg",
          0.7,
        );
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function handleFile(file: File) {
    setStep("processing");
    setError(null);

    const compressed = await compressImage(file).catch(() => file);
    const formData = new FormData();
    formData.append("photo", compressed, "photo.jpg");

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const resp = await fetch(
        `${API_URL}/api/sessions/${year}/${round}/sync-photo?type=${sessionType}`,
        { method: "POST", body: formData },
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

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-f1-card border border-f1-border rounded-xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-f1-border">
          <h2 className="text-lg font-bold text-white">Sync with TV</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Instructions */}
          {step === "instructions" && (
            <div className="space-y-4">
              <p className="text-sm text-f1-muted leading-relaxed">
                Sync the replay with your TV broadcast by taking a photo of the
                leaderboard on screen.
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
                    Take a photo and we'll match it to the exact moment in the race
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

              {isDev && (
                <button
                  onClick={handleUpload}
                  className="w-full py-3 bg-f1-border hover:bg-white/20 rounded-lg text-white font-bold text-sm transition-colors"
                >
                  Upload Image (dev)
                </button>
              )}

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
                accept="image/*"
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
                    Lap {result.lap} — {formatTime(result.timestamp)}
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
                onClick={() => {
                  onSync(result.timestamp);
                  onClose();
                }}
                className="w-full py-3 bg-f1-red hover:bg-red-700 rounded-lg text-white font-bold text-sm transition-colors"
              >
                Sync to this moment
              </button>

              <button
                onClick={() => {
                  setResult(null);
                  setStep("capture");
                }}
                className="w-full text-sm text-f1-muted hover:text-white transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
