"use client";

import { useRef, useEffect } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker, SectorOverlay } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  trackStatus?: string;
  drivers: DriverMarker[];
  highlightedDrivers: string[];
  playbackSpeed?: number;
  showDriverNames?: boolean;
  sectorOverlay?: SectorOverlay | null;
}

// Longer than the 500ms frame interval so the dot is always still moving
// when the next target arrives - the more overlap, the smoother the motion
const BASE_INTERP_MS = 750;

interface PosEntry {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  startTime: number;
  duration: number;
}

function getCanvasWindow(canvas: HTMLCanvasElement | null): Window {
  return canvas?.ownerDocument?.defaultView || window;
}


export default function TrackCanvas({ trackPoints, rotation, trackStatus = "green", drivers, highlightedDrivers, playbackSpeed = 1, showDriverNames = true, sectorOverlay = null }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const posRef = useRef<Map<string, PosEntry>>(new Map());
  const driversRef = useRef<DriverMarker[]>([]);
  const trackStatusRef = useRef(trackStatus);
  trackStatusRef.current = trackStatus;
  const speedRef = useRef(playbackSpeed);
  speedRef.current = playbackSpeed;
  const showNamesRef = useRef(showDriverNames);
  showNamesRef.current = showDriverNames;
  const sectorOverlayRef = useRef(sectorOverlay);
  sectorOverlayRef.current = sectorOverlay;

  // Update targets when drivers prop changes
  useEffect(() => {
    driversRef.current = drivers;
    const now = performance.now();
    // Scale interpolation duration with speed so dots keep up
    const duration = BASE_INTERP_MS / Math.max(speedRef.current, 0.25);

    for (const drv of drivers) {
      const entry = posRef.current.get(drv.abbr);
      if (!entry) {
        // First time seeing driver - snap to position
        posRef.current.set(drv.abbr, {
          prevX: drv.x, prevY: drv.y,
          targetX: drv.x, targetY: drv.y,
          startTime: now,
          duration,
        });
      } else {
        // Start new interpolation from current visual position
        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / entry.duration, 1);
        entry.prevX = entry.prevX + (entry.targetX - entry.prevX) * t;
        entry.prevY = entry.prevY + (entry.targetY - entry.prevY) * t;
        entry.targetX = drv.x;
        entry.targetY = drv.y;
        entry.startTime = now;
        entry.duration = duration;
      }
    }
  }, [drivers]);

  // Continuous animation loop
  useEffect(() => {
    let running = true;

    function animate() {
      if (!running) return;

      const canvas = canvasRef.current;
      const hostWindow = getCanvasWindow(canvas);
      if (!canvas) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      const dpr = hostWindow.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;

      if (w === 0 || h === 0) {
        hostWindow.requestAnimationFrame(animate);
        return;
      }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      drawTrack(ctx, trackPoints, w, h, rotation, trackStatusRef.current, sectorOverlayRef.current);

      const now = performance.now();
      const curr = driversRef.current;
      const interpolated: DriverMarker[] = curr.map((drv) => {
        const entry = posRef.current.get(drv.abbr);
        if (!entry) return drv;

        const elapsed = now - entry.startTime;
        const t = Math.min(elapsed / entry.duration, 1);
        const x = entry.prevX + (entry.targetX - entry.prevX) * t;
        const y = entry.prevY + (entry.targetY - entry.prevY) * t;

        return { ...drv, x, y };
      });

      drawDrivers(ctx, interpolated, trackPoints, w, h, rotation, highlightedDrivers, showNamesRef.current);

      hostWindow.requestAnimationFrame(animate);
    }

    const hostWindow = getCanvasWindow(canvasRef.current);
    hostWindow.requestAnimationFrame(animate);
    return () => { running = false; };
  }, [trackPoints, rotation, highlightedDrivers]);

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hostWindow = el.ownerDocument?.defaultView || window;

    const rect = el.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };

    const observer = new hostWindow.ResizeObserver((entries) => {
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
