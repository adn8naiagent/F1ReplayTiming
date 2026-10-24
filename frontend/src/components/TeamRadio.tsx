"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import type { ReplayDriver } from "@/hooks/useReplaySocket";

// Team radio pop-ups over the track map (or the broadcast): the driver, the
// caption, and the clip playing. Clips are the ones F1 picks for the world
// feed; the audio streams straight from F1.

export interface RadioClip {
  /** Replay seconds (replays only) */
  t?: number;
  /** F1's clip path (live only), unique per clip */
  id?: string;
  utc: string | null;
  racing_number: string;
  driver: string;
  url: string | null;
  transcript: string | null;
}

// A jump bigger than this (replay seconds) is a seek: don't fire everything skipped.
const MAX_STEP_S = 30;
// Clips waiting behind the one on screen; older ones are dropped.
const MAX_QUEUE = 3;
// How long the caption stays after the audio ends (ms).
const LINGER_MS = 1500;

function readingMs(text: string | null): number {
  return Math.min(10000, Math.max(4000, 1500 + (text?.length ?? 0) * 55));
}

const clipKey = (c: RadioClip) => c.id ?? `${c.t}_${c.racing_number}`;

interface Props {
  enabled: boolean;
  audio: boolean;
  clips: RadioClip[] | undefined;
  /** "replay": fire clips as currentTime passes them. "live": fire clips as they arrive. */
  mode: "replay" | "live";
  currentTime?: number;
  playing?: boolean;
  speed?: number;
  drivers: ReplayDriver[];
}

export default function TeamRadio({ enabled, audio, clips, mode, currentTime = 0, playing = true, speed = 1, drivers }: Props) {
  const [current, setCurrent] = useState<RadioClip | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const queueRef = useRef<RadioClip[]>([]);
  const lastTimeRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0); // bumps when the queue changes

  // Only play audio at normal speed: sped-up replays would talk over themselves.
  const playAudio = audio && (mode === "live" || (playing && speed === 1));

  const clearCurrent = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioPlaying(false);
    setCurrent(null);
  };

  const reset = () => {
    queueRef.current = [];
    clearCurrent();
  };

  useEffect(() => () => reset(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) reset();
    lastTimeRef.current = null;
    seenRef.current = null;
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = (fresh: RadioClip[]) => {
    if (fresh.length === 0) return;
    queueRef.current = [...queueRef.current, ...fresh].slice(-MAX_QUEUE);
    setTick((n) => n + 1);
  };

  // Replay: fire clips the playhead has just passed.
  useEffect(() => {
    if (!enabled || mode !== "replay" || !clips) return;
    const prev = lastTimeRef.current;
    const now = currentTime;
    lastTimeRef.current = now;
    if (prev === null) return;
    if (now < prev - 2 || now - prev > MAX_STEP_S) {
      // Scrubbed or skipped: start again from here.
      if (now < prev) reset();
      return;
    }
    if (now <= prev) return;
    enqueue(clips.filter((c) => c.t !== undefined && c.t > prev && c.t <= now));
  }, [enabled, mode, clips, currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: fire clips that weren't in the last frame. The first frame's clips
  // are already old, so they're only marked as seen.
  useEffect(() => {
    if (!enabled || mode !== "live" || !clips) return;
    if (seenRef.current === null) {
      seenRef.current = new Set(clips.map(clipKey));
      return;
    }
    const fresh = clips.filter((c) => !seenRef.current!.has(clipKey(c)));
    fresh.forEach((c) => seenRef.current!.add(clipKey(c)));
    enqueue(fresh);
  }, [enabled, mode, clips]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the next clip when nothing is on screen.
  useEffect(() => {
    if (current || queueRef.current.length === 0) return;
    const next = queueRef.current[0];
    queueRef.current = queueRef.current.slice(1);
    setCurrent(next);

    const done = () => {
      timerRef.current = setTimeout(() => {
        audioRef.current = null;
        setAudioPlaying(false);
        setCurrent(null);
      }, LINGER_MS);
    };

    if (playAudio && next.url) {
      const el = new Audio(next.url);
      audioRef.current = el;
      el.onended = done;
      el.onerror = () => {
        setAudioPlaying(false);
        timerRef.current = setTimeout(() => setCurrent(null), readingMs(next.transcript));
      };
      el.play().then(() => setAudioPlaying(true)).catch(() => el.onerror?.(new Event("error")));
    } else {
      timerRef.current = setTimeout(() => setCurrent(null), readingMs(next.transcript));
    }
  }, [current, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause the clip with the replay, and carry on when it resumes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || mode !== "replay") return;
    if (playing) {
      if (el.paused && !el.ended) el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [playing, mode]);

  if (!enabled || !current) return null;

  const drv = drivers.find((d) => d.abbr === current.driver);
  const color = drv?.color || "#FFFFFF";

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-[min(30rem,calc(100%-1.5rem))]">
      <div
        key={clipKey(current)}
        className="lap-bubble flex items-start gap-3 pl-2 pr-4 py-2.5 rounded-lg bg-f1-card/95 border border-f1-border shadow-lg backdrop-blur-sm"
      >
        <span className="w-1.5 self-stretch rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-extrabold text-white tracking-wide">{current.driver || `#${current.racing_number}`}</span>
            <span className="text-[10px] font-bold text-f1-muted uppercase tracking-wider">Team radio</span>
            <AudioLines className={`w-4 h-4 ml-auto flex-shrink-0 ${audioPlaying ? "text-white animate-pulse" : "text-f1-muted"}`} />
          </div>
          {current.transcript && (
            <p className="text-sm text-white/90 leading-snug mt-0.5">&ldquo;{current.transcript}&rdquo;</p>
          )}
        </div>
      </div>
    </div>
  );
}
