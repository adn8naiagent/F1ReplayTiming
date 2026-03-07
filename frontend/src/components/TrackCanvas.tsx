"use client";

import { useRef, useEffect } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  drivers: DriverMarker[];
  highlightedDriver: string | null;
}

const LERP_SPEED = 0.08; // fraction of remaining distance to close per frame (~60fps)

export default function TrackCanvas({ trackPoints, rotation, drivers, highlightedDriver }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Target positions (updated from props) and smoothed positions (animated)
  const targetRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const smoothRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const driversRef = useRef<DriverMarker[]>([]);

  // Update targets when drivers prop changes
  useEffect(() => {
    driversRef.current = drivers;
    for (const drv of drivers) {
      targetRef.current.set(drv.abbr, { x: drv.x, y: drv.y });
      // Initialize smooth position if first time seeing this driver
      if (!smoothRef.current.has(drv.abbr)) {
        smoothRef.current.set(drv.abbr, { x: drv.x, y: drv.y });
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

      drawTrack(ctx, trackPoints, w, h, rotation);

      // Smoothly lerp toward target positions each animation frame
      const curr = driversRef.current;
      const interpolated: DriverMarker[] = curr.map((drv) => {
        const target = targetRef.current.get(drv.abbr);
        const smooth = smoothRef.current.get(drv.abbr);
        if (!target || !smooth) return drv;

        // Exponential lerp: close LERP_SPEED of remaining distance each frame
        smooth.x += (target.x - smooth.x) * LERP_SPEED;
        smooth.y += (target.y - smooth.y) * LERP_SPEED;

        return { ...drv, x: smooth.x, y: smooth.y };
      });

      drawDrivers(ctx, interpolated, trackPoints, w, h, rotation, highlightedDriver);

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    return () => { running = false; };
  }, [trackPoints, rotation, highlightedDriver]);

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
