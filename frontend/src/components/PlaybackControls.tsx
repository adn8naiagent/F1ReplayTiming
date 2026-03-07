"use client";

import { SPEED_OPTIONS } from "@/lib/constants";

const SKIP_OPTIONS = [
  { label: "10s", seconds: 10 },
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
}: Props) {
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

  return (
    <div className="bg-f1-card border-t border-f1-border px-6 py-3">
      {/* Progress bar */}
      <div
        className="w-full h-2 bg-f1-border rounded-full mb-3 cursor-pointer relative group"
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

        {/* Play/Pause */}
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

        {/* Time */}
        <span className="text-sm font-extrabold text-white ml-auto">
          {formatTime(currentTime)}{showSessionTime && ` / ${formatTime(totalTime)}`}
        </span>

        {/* Lap selector */}
        <div className="flex items-center gap-1">
          <span className="text-sm font-extrabold text-white">Lap</span>
          <input
            type="number"
            min={1}
            max={totalLaps}
            defaultValue={currentLap}
            key={currentLap}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const lap = Number((e.target as HTMLInputElement).value);
                if (lap >= 1 && lap <= totalLaps && onSeekToLap) {
                  onSeekToLap(lap);
                }
              }
            }}
            onBlur={(e) => {
              const lap = Number(e.target.value);
              if (lap >= 1 && lap <= totalLaps && onSeekToLap) {
                onSeekToLap(lap);
              }
            }}
            className="bg-f1-border text-white text-sm font-extrabold rounded px-1.5 py-0.5 w-10 text-center appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-sm font-extrabold text-white">/{totalLaps}</span>
        </div>
      </div>
    </div>
  );
}
