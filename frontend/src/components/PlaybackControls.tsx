"use client";

import { useState } from "react";
import { SPEED_OPTIONS } from "@/lib/constants";
import { QualiPhase, QualiPhaseInfo } from "@/hooks/useReplaySocket";

const SKIP_OPTIONS = [
  { label: "5s", seconds: 5 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];

interface Props {
  playing: boolean;
  speed: number;
  currentTime: number;
  totalTime: number;
  currentLap: number;
  totalLaps: number;
  finished: boolean;
  showSessionTime: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (time: number) => void;
  onReset: () => void;
  onSeekToLap?: (lap: number) => void;
  isRace?: boolean;
  onSyncPhoto?: () => void;
  qualiPhase?: QualiPhase | null;
  qualiPhases?: QualiPhaseInfo[];
}

export default function PlaybackControls({
  playing,
  speed,
  currentTime,
  totalTime,
  currentLap,
  totalLaps,
  finished,
  showSessionTime,
  onPlay,
  onPause,
  onSpeedChange,
  onSeek,
  onReset,
  onSeekToLap,
  isRace,
  onSyncPhoto,
  qualiPhase,
  qualiPhases,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function skip(delta: number) {
    const target = Math.max(0, Math.min(totalTime, currentTime + delta));
    onSeek(target);
  }

  // Play/pause button (shared between mobile compact and full views)
  const playPauseBtn = (
    <button
      onClick={finished ? onReset : playing ? onPause : onPlay}
      className="w-10 h-10 flex items-center justify-center bg-f1-red hover:bg-red-700 rounded-full transition-colors text-white flex-shrink-0"
    >
      {finished ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
        </svg>
      ) : playing ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );

  const progressBar = (
    <div
      className="w-full h-2 bg-f1-border rounded-full cursor-pointer relative group"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        onSeek(pct * totalTime);
      }}
    >
      <div
        className="h-full bg-f1-red rounded-full transition-all duration-100 relative"
        style={{ width: `${progress}%` }}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  // Mobile compact layout
  return (
    <div className="bg-f1-card border-t border-f1-border">
      {/* Mobile: compact bar always visible */}
      <div className="sm:hidden px-3 pt-2 pb-1">
        <div className="mb-2">{progressBar}</div>
        <div className="flex items-center gap-2">
          {playPauseBtn}
          <span className="text-xs font-extrabold text-white tabular-nums flex-1">
            {formatTime(currentTime)}
            {isRace && currentLap > 0 && <span className="text-f1-muted ml-2">L{currentLap}/{totalLaps}</span>}
            {!isRace && qualiPhase && <span className="text-f1-muted ml-2">{qualiPhase.phase}</span>}
          </span>
          <span className="text-[10px] font-bold text-f1-muted">{speed}x</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-f1-muted"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile: expanded controls */}
      {expanded && (
        <div className="sm:hidden px-3 pb-2 space-y-2 border-t border-f1-border/50 pt-2">
          {/* Skip buttons */}
          <div className="flex items-center justify-center gap-1">
            {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => (
              <button
                key={`back-${label}`}
                onClick={() => skip(-seconds)}
                className="px-2 py-1.5 text-[10px] font-bold text-f1-muted hover:text-white rounded bg-f1-border/50 hover:bg-white/10 transition-colors"
              >
                -{label}
              </button>
            ))}
            <span className="w-2" />
            {SKIP_OPTIONS.map(({ label, seconds }) => (
              <button
                key={`fwd-${label}`}
                onClick={() => skip(seconds)}
                className="px-2 py-1.5 text-[10px] font-bold text-f1-muted hover:text-white rounded bg-f1-border/50 hover:bg-white/10 transition-colors"
              >
                +{label}
              </button>
            ))}
          </div>

          {/* Speed buttons */}
          <div className="flex items-center justify-center gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSpeedChange(s)}
                className={`px-2.5 py-1.5 text-xs font-bold rounded transition-colors ${
                  speed === s
                    ? "bg-f1-red text-white"
                    : "bg-f1-border text-f1-muted hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Qualifying phase buttons */}
          {qualiPhases && qualiPhases.length > 0 && (
            <div className="flex items-center justify-center gap-1">
              {qualiPhases.map((qp) => (
                <button
                  key={qp.phase}
                  onClick={() => onSeek(qp.timestamp)}
                  className={`px-2.5 py-1.5 text-xs font-bold rounded transition-colors ${
                    qualiPhase?.phase === qp.phase
                      ? "bg-f1-red text-white"
                      : "bg-f1-border text-f1-muted hover:text-white"
                  }`}
                >
                  {qp.phase}
                </button>
              ))}
            </div>
          )}

          {/* Race: Sync + Lap selector */}
          {isRace && (
            <div className="flex items-center justify-center gap-3">
              {onSyncPhoto && (
                <button
                  onClick={onSyncPhoto}
                  className="px-3 py-1.5 rounded border border-f1-border hover:bg-white/10 transition-colors text-f1-muted hover:text-white text-xs font-bold"
                >
                  Sync
                </button>
              )}
              {onSeekToLap && (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-extrabold text-white">Lap</span>
                  <select
                    value={currentLap}
                    onChange={(e) => onSeekToLap(Number(e.target.value))}
                    className="bg-f1-border text-white text-xs font-extrabold rounded px-2 py-1 cursor-pointer"
                  >
                    {Array.from({ length: totalLaps }, (_, i) => i + 1).map((lap) => (
                      <option key={lap} value={lap} className="bg-f1-card text-white">{lap}</option>
                    ))}
                  </select>
                  <span className="text-xs font-extrabold text-white">/{totalLaps}</span>
                </div>
              )}
            </div>
          )}

          {/* Quali: time info */}
          {!isRace && qualiPhase && (
            <div className="flex items-center justify-center gap-4">
              <span className="text-xs font-extrabold text-white">{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="text-[9px] font-bold text-f1-muted uppercase block">Remaining</span>
                <span className="text-xs font-extrabold text-white tabular-nums">{formatTime(qualiPhase.remaining)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Desktop: full layout (unchanged) */}
      <div className="hidden sm:block px-6 py-3">
        <div className="mb-3">{progressBar}</div>

        <div className="flex items-center gap-3">
          {/* Skip back buttons */}
          <div className="flex items-center gap-0.5">
            {[...SKIP_OPTIONS].reverse().map(({ label, seconds }) => (
              <button
                key={`back-${label}`}
                onClick={() => skip(-seconds)}
                className="px-1.5 py-1 text-[10px] font-bold text-f1-muted hover:text-white rounded hover:bg-white/10 transition-colors"
                title={`Back ${label}`}
              >
                -{label}
              </button>
            ))}
          </div>

          {playPauseBtn}

          {/* Skip forward buttons */}
          <div className="flex items-center gap-0.5">
            {SKIP_OPTIONS.map(({ label, seconds }) => (
              <button
                key={`fwd-${label}`}
                onClick={() => skip(seconds)}
                className="px-1.5 py-1 text-[10px] font-bold text-f1-muted hover:text-white rounded hover:bg-white/10 transition-colors"
                title={`Forward ${label}`}
              >
                +{label}
              </button>
            ))}
          </div>

          {/* Speed buttons */}
          <div className="flex items-center gap-1 ml-2">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSpeedChange(s)}
                className={`px-2 py-1 text-xs font-bold rounded transition-colors ${
                  speed === s
                    ? "bg-f1-red text-white"
                    : "bg-f1-border text-f1-muted hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Qualifying phase skip buttons */}
          {qualiPhases && qualiPhases.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {qualiPhases.map((qp) => (
                <button
                  key={qp.phase}
                  onClick={() => onSeek(qp.timestamp)}
                  className={`px-2 py-1 text-xs font-bold rounded transition-colors ${
                    qualiPhase?.phase === qp.phase
                      ? "bg-f1-red text-white"
                      : "bg-f1-border text-f1-muted hover:text-white"
                  }`}
                >
                  {qp.phase}
                </button>
              ))}
            </div>
          )}

          {/* Time display */}
          {isRace ? (
            <>
              <span className="text-sm font-extrabold text-white ml-auto tabular-nums">
                {formatTime(currentTime)}{showSessionTime && ` / ${formatTime(totalTime)}`}
              </span>

              {onSyncPhoto && (
                <button
                  onClick={onSyncPhoto}
                  className="px-3 py-1.5 rounded border border-f1-border hover:bg-white/10 transition-colors text-f1-muted hover:text-white text-xs font-bold"
                >
                  Sync
                </button>
              )}

              <div className="flex items-center gap-1">
                <span className="text-sm font-extrabold text-white">Lap</span>
                <select
                  value={currentLap}
                  onChange={(e) => {
                    const lap = Number(e.target.value);
                    if (onSeekToLap) {
                      onSeekToLap(lap);
                    }
                  }}
                  className="bg-f1-border text-white text-sm font-extrabold rounded px-2 py-1 cursor-pointer hover:bg-white/20 transition-colors"
                >
                  {Array.from({ length: totalLaps }, (_, i) => i + 1).map((lap) => (
                    <option key={lap} value={lap} className="bg-f1-card text-white">
                      {lap}
                    </option>
                  ))}
                </select>
                <span className="text-sm font-extrabold text-white">/{totalLaps}</span>
              </div>
            </>
          ) : qualiPhase ? (
            <div className="flex items-end gap-4 ml-auto">
              <span className="text-sm font-extrabold text-white" style={{ marginBottom: 1, marginRight: -10 }}>{qualiPhase.phase}</span>
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Remaining</span>
                <span className="text-sm font-extrabold text-white tabular-nums">
                  {formatTime(qualiPhase.remaining)}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Elapsed</span>
                <span className="text-sm font-extrabold text-f1-muted tabular-nums">{formatTime(currentTime)}</span>
              </div>
              {showSessionTime && (
                <div className="text-center">
                  <span className="text-[10px] font-bold text-f1-muted uppercase block">Total</span>
                  <span className="text-sm font-extrabold text-f1-muted tabular-nums">{formatTime(Math.max(0, totalTime - currentTime))}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4 ml-auto">
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Remaining</span>
                <span className="text-sm font-extrabold text-white tabular-nums">{formatTime(Math.max(0, totalTime - currentTime))}</span>
              </div>
              <div className="text-center">
                <span className="text-[10px] font-bold text-f1-muted uppercase block">Elapsed</span>
                <span className="text-sm font-extrabold text-f1-muted tabular-nums">{formatTime(currentTime)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
