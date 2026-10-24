"use client";

import { useEffect, useRef, useState } from "react";

// Keeps a <video> locked to the replay clock: video time = session time + offset.
// The replay is the master; the video speeds up or slows down slightly to
// close small gaps and seeks when it's too far out.

const SEEK_THRESHOLD = 2; // seconds
const MAX_RATE_ADJUST = 0.2; // ±20% of the replay speed

export function useReplayClock(timestamp: number | undefined, playing: boolean, speed: number) {
  const anchor = useRef({ ts: timestamp ?? 0, at: 0 });
  useEffect(() => {
    anchor.current = { ts: timestamp ?? 0, at: performance.now() };
  }, [timestamp]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  /** Session time now, extrapolated between replay frames. */
  return () => {
    const { ts, at } = anchor.current;
    if (!playingRef.current) return ts;
    const elapsed = Math.min((performance.now() - at) / 1000, 1.5) * speedRef.current;
    return ts + elapsed;
  };
}

export function useVideoSync(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  clock: () => number,
  playing: boolean,
  speed: number,
  offset: number | null,
) {
  const [drift, setDrift] = useState<number | null>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;

  useEffect(() => {
    if (!enabled || offset === null) {
      setDrift(null);
      return;
    }
    let ticks = 0;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      const target = clockRef.current() + offset;
      const diff = target - video.currentTime;
      if (++ticks % 4 === 0) setDrift(diff);

      if (!playing) {
        if (!video.paused) video.pause();
        if (Math.abs(diff) > 0.3) video.currentTime = target;
        return;
      }
      if (video.paused) void video.play().catch(() => {});
      if (Math.abs(diff) > SEEK_THRESHOLD) {
        video.currentTime = target;
        video.playbackRate = speed;
        return;
      }
      const adjust = Math.max(-MAX_RATE_ADJUST, Math.min(MAX_RATE_ADJUST, diff * 0.5));
      video.playbackRate = speed * (1 + adjust);
    }, 250);
    return () => clearInterval(id);
  }, [videoRef, enabled, playing, speed, offset]);

  return drift;
}
