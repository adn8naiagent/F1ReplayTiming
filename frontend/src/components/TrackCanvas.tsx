"use client";

import { useRef, useEffect } from "react";
import { drawTrack, drawDrivers, TrackPoint, DriverMarker, SectorOverlay, SegmentOverlay, Corner, MarshalSector, SectorFlag, ELEVATION_FULL_SCALE_M } from "@/lib/trackRenderer";

interface Props {
  trackPoints: TrackPoint[];
  rotation: number;
  trackStatus?: string;
  drivers: DriverMarker[];
  highlightedDrivers: string[];
  playbackSpeed?: number;
  showDriverNames?: boolean;
  sectorOverlay?: SectorOverlay | null;
  /** Track dominance or mini-sector colours; drawn over everything else */
  segmentOverlay?: SegmentOverlay | null;
  corners?: Corner[] | null;
  marshalSectors?: MarshalSector[] | null;
  sectorFlags?: SectorFlag[] | null;
  showElevation?: boolean;
  /** Track line width in pixels; thinner for small overlays */
  trackWidth?: number;
  /** A white track, for drawing over video */
  lightTrack?: boolean;
  /** Small margins, for a small map with nothing around it */
  compact?: boolean;
  elevationRangeM?: number | null;
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


export default function TrackCanvas({ trackPoints, rotation, trackStatus = "green", drivers, highlightedDrivers, playbackSpeed = 1, showDriverNames = true, sectorOverlay = null, segmentOverlay = null, corners = null, marshalSectors = null, sectorFlags = null, showElevation = false, elevationRangeM = null, trackWidth = 12, lightTrack = false, compact = false }: Props) {
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
  const segmentOverlayRef = useRef(segmentOverlay);
  segmentOverlayRef.current = segmentOverlay;
  const cornersRef = useRef(corners);
  cornersRef.current = corners;
  const marshalSectorsRef = useRef(marshalSectors);
  marshalSectorsRef.current = marshalSectors;
  const sectorFlagsRef = useRef(sectorFlags);
  sectorFlagsRef.current = sectorFlags;
  const lightTrackRef = useRef(lightTrack);
  lightTrackRef.current = lightTrack;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;
  const showElevationRef = useRef(showElevation);
  showElevationRef.current = showElevation;

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

      drawTrack(ctx, trackPoints, w, h, rotation, trackStatusRef.current, sectorOverlayRef.current, cornersRef.current, marshalSectorsRef.current, sectorFlagsRef.current, showElevationRef.current, segmentOverlayRef.current, trackWidthRef.current, lightTrackRef.current, compactRef.current);

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

      drawDrivers(ctx, interpolated, trackPoints, w, h, rotation, highlightedDrivers, showNamesRef.current, compactRef.current);

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

  const showElevationLegend = showElevation && trackPoints.some((p) => typeof p.z === "number");

  return (
    <div ref={containerRef} className="w-full h-full bg-f1-dark relative">
      <canvas ref={canvasRef} className="w-full h-full" />
      {showElevationLegend && (
        <div className="absolute bottom-16 left-3 flex items-end gap-2 pointer-events-none select-none">
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-f1-muted leading-none mb-1">{ELEVATION_FULL_SCALE_M}m</span>
            <div
              className="w-2 h-20 rounded-sm border border-black/30"
              style={{ background: "linear-gradient(to top, #33384a, #6fb7d6, #ffffff)" }}
            />
            <span className="text-[9px] text-f1-muted leading-none mt-1">0m</span>
          </div>
          {typeof elevationRangeM === "number" && (
            <span className="text-[10px] font-bold text-f1-text leading-none mb-1">
              Elevation Δ {elevationRangeM}m
            </span>
          )}
        </div>
      )}
    </div>
  );
}
