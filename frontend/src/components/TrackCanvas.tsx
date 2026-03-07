"use client";

import { useRef, useEffect } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  trackStatus?: string;
  drivers: DriverMarker[];
  highlightedDrivers: string[];
}

// Duration (ms) over which to linearly interpolate between position updates
const INTERP_DURATION = 500;

interface PosEntry {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  startTime: number;
}

export default function TrackCanvas({ trackPoints, rotation, trackStatus = "green", drivers, highlightedDrivers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Per-driver interpolation state
  const posRef = useRef<Map<string, PosEntry>>(new Map());
  const driversRef = useRef<DriverMarker[]>([]);
  const trackStatusRef = useRef(trackStatus);
  trackStatusRef.current = trackStatus;

  // Update targets when drivers prop changes
  useEffect(() => {
    driversRef.current = drivers;
    const now = performance.now();
    for (const drv of drivers) {
      const entry = posRef.current.get(drv.abbr);
      if (!entry) {
        // First time seeing driver — snap to position
        posRef.current.set(drv.abbr, {
          prevX: drv.x, prevY: drv.y,
          targetX: drv.x, targetY: drv.y,
          startTime: now,
        });
      } else {
        // Compute current interpolated position as new "prev"
        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / INTERP_DURATION, 1);
        const curX = entry.prevX + (entry.targetX - entry.prevX) * t;
        const curY = entry.prevY + (entry.targetY - entry.prevY) * t;
        entry.prevX = curX;
        entry.prevY = curY;
        entry.targetX = drv.x;
        entry.targetY = drv.y;
        entry.startTime = now;
      }
    }
  }, [drivers]);

  // Continuous animation loop
  useEffect(() => {
    let running = true;

    function animate() {
      if (!running) return;

      const canvas = canvasRef.current;
      if (!canvas) {
        requestAnimationFrame(animate);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        requestAnimationFrame(animate);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;

      if (w === 0 || h === 0) {
        requestAnimationFrame(animate);
        return;
      }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      drawTrack(ctx, trackPoints, w, h, rotation, trackStatusRef.current);

      // Linearly interpolate between previous and target positions
      const now = performance.now();
      const curr = driversRef.current;
      const interpolated: DriverMarker[] = curr.map((drv) => {
        const entry = posRef.current.get(drv.abbr);
        if (!entry) return drv;

        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / INTERP_DURATION, 1);
        const x = entry.prevX + (entry.targetX - entry.prevX) * t;
        const y = entry.prevY + (entry.targetY - entry.prevY) * t;

        return { ...drv, x, y };
      });

      drawDrivers(ctx, interpolated, trackPoints, w, h, rotation, highlightedDrivers);

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    return () => { running = false; };
  }, [trackPoints, rotation, highlightedDrivers]);

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full bg-f1-dark">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
