export interface TrackPoint {
  x: number;
  y: number;
  z?: number; // metres above the track's lowest point
}

// Fixed elevation scale (metres). The hilliest F1 circuits have ~100 m of
// relief, so colours are mapped against this constant for every track. Flat
// tracks then occupy only the bottom of the ramp and stay looking flat.
export const ELEVATION_FULL_SCALE_M = 100;

// Cool brightness ramp: slate (low) -> cyan -> white (high).
const ELEVATION_STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0.0, rgb: [0x33, 0x38, 0x4a] },
  { t: 0.5, rgb: [0x6f, 0xb7, 0xd6] },
  { t: 1.0, rgb: [0xff, 0xff, 0xff] },
];

export function elevationColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  let lo = ELEVATION_STOPS[0];
  let hi = ELEVATION_STOPS[ELEVATION_STOPS.length - 1];
  for (let i = 0; i < ELEVATION_STOPS.length - 1; i++) {
    if (c >= ELEVATION_STOPS[i].t && c <= ELEVATION_STOPS[i + 1].t) {
      lo = ELEVATION_STOPS[i];
      hi = ELEVATION_STOPS[i + 1];
      break;
    }
  }
  const span = hi.t - lo.t || 1;
  const f = (c - lo.t) / span;
  const r = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f);
  const g = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f);
  const b = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

export interface DriverMarker {
  abbr: string;
  x: number;
  y: number;
  color: string;
  position: number | null;
}

export interface Corner {
  x: number;
  y: number;
  number: number;
  letter: string;
  angle: number;
}

export interface MarshalSector {
  x: number;
  y: number;
  number: number;
}

export interface SectorFlag {
  sector: number;
  flag: string;
  driver: string;
}

export interface SectorOverlay {
  boundaries: { s1_end: number; s2_end: number; total: number };
  colors: { s1: string; s2: string; s3: string };
}

/** Track coloured in pieces, each a fraction of the lap (0–1 from the line,
 *  by distance). Used for track dominance and mini-sectors. */
export interface SegmentOverlay {
  segments: { from: number; to: number; color: string }[];
}

/** Each outline point's position along the lap, 0–1 by distance. */
export function lapFractions(points: { x: number; y: number }[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[cum.length - 1] || 1;
  return cum.map((c) => c / total);
}

// Sector overlay colour used when a sector has no posted time; matches the
// DEFAULT_SECTOR the replay page passes. Skipped when layering over elevation.
const DEFAULT_SECTOR_HEX = "#3A3A4A";

const TRACK_STATUS_COLORS: Record<string, string> = {
  green: "#3A3A4A",
  yellow: "#F5C518",
  sc: "#F5C518",
  vsc: "#F5C518",
  red: "#E10600",
};

export function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  trackStatus: string = "green",
  sectorOverlay?: SectorOverlay | null,
  corners?: Corner[] | null,
  marshalSectors?: MarshalSector[] | null,
  sectorFlags?: SectorFlag[] | null,
  showElevation: boolean = false,
  segmentOverlay?: SegmentOverlay | null,
  /** Track line width in pixels (thinner for small maps) */
  trackWidth: number = 12,
  /** A white track, for drawing over video */
  lightTrack: boolean = false,
) {
  if (points.length === 0) return;

  // Elevation colouring needs per-point heights; only active when requested
  // and the data is present.
  const elevationActive = showElevation && points.some((p) => typeof p.z === "number");

  const padX = 40;
  const padTop = 60;
  const padBottom = 90;
  const w = width - padX * 2;
  const h = height - padTop - padBottom;

  // Rotation is pre-applied in the backend; keep for any future manual override
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Center of the normalized track
  const cx = 0.5;
  const cy = 0.5;

  const rotated = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: dx * cos - dy * sin + cx,
      y: dx * sin + dy * cos + cy,
    };
  });

  // Find bounds after rotation
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotated) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(w / rangeX, h / rangeY);

  const offsetX = padX + (w - rangeX * scale) / 2;
  const offsetY = padTop + (h - rangeY * scale) / 2;

  function toScreen(p: TrackPoint): [number, number] {
    return [
      offsetX + (p.x - minX) * scale,
      offsetY + (maxY - p.y) * scale, // Flip Y: data Y-up → screen Y-down
    ];
  }

  // Draw track outline. Priority: segments > elevation > sector overlay > plain.
  if (segmentOverlay && segmentOverlay.segments.length > 0) {
    const frac = lapFractions(points);
    ctx.lineWidth = trackWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.strokeStyle = DEFAULT_SECTOR_HEX;
    rotated.forEach((p, i) => {
      const [px, py] = toScreen(p);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    // Butt caps between pieces, so neighbouring colours don't overlap
    ctx.lineCap = "butt";
    for (const seg of segmentOverlay.segments) {
      ctx.beginPath();
      ctx.strokeStyle = seg.color;
      let started = false;
      for (let i = 0; i < rotated.length; i++) {
        // Include the point either side so pieces join without gaps
        const inside = frac[i] >= seg.from && frac[i] <= seg.to;
        const edge = (i + 1 < rotated.length && frac[i + 1] > seg.from && frac[i] < seg.from)
          || (i > 0 && frac[i - 1] < seg.to && frac[i] > seg.to);
        if (!inside && !edge) continue;
        const [px, py] = toScreen(rotated[i]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.lineCap = "round";
  } else if (elevationActive) {
    // Colour each segment by its height on the fixed scale. Bucketing keeps
    // this to a handful of stroke calls per frame instead of one per point.
    const STOPS = 24;
    const buckets: Path2D[] = Array.from({ length: STOPS }, () => new Path2D());
    for (let i = 0; i < rotated.length; i++) {
      const j = (i + 1) % rotated.length;
      const z = points[i].z ?? 0;
      const t = Math.max(0, Math.min(1, z / ELEVATION_FULL_SCALE_M));
      const level = Math.min(STOPS - 1, Math.floor(t * STOPS));
      const [x1, y1] = toScreen(rotated[i]);
      const [x2, y2] = toScreen(rotated[j]);
      buckets[level].moveTo(x1, y1);
      buckets[level].lineTo(x2, y2);
    }
    ctx.lineWidth = trackWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let level = 0; level < STOPS; level++) {
      ctx.strokeStyle = elevationColor((level + 0.5) / STOPS);
      ctx.stroke(buckets[level]);
    }

    // If the user has also selected sector shading, draw the highlighted
    // sector colours on top of the elevation. Un-timed sectors (default grey)
    // are skipped so the elevation shows through where there's no highlight.
    if (sectorOverlay) {
      const { boundaries, colors } = sectorOverlay;
      const segments = [
        { start: 0, end: boundaries.s1_end, color: colors.s1 },
        { start: boundaries.s1_end, end: boundaries.s2_end, color: colors.s2 },
        { start: boundaries.s2_end, end: rotated.length - 1, color: colors.s3 },
      ];
      for (const seg of segments) {
        if (seg.color.toUpperCase() === DEFAULT_SECTOR_HEX) continue;
        ctx.beginPath();
        ctx.strokeStyle = seg.color;
        const [sx2, sy2] = toScreen(rotated[seg.start]);
        ctx.moveTo(sx2, sy2);
        for (let i = seg.start + 1; i <= seg.end && i < rotated.length; i++) {
          const [px, py] = toScreen(rotated[i]);
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  } else if (sectorOverlay) {
    const { boundaries, colors } = sectorOverlay;
    const segments = [
      { start: 0, end: boundaries.s1_end, color: colors.s1 },
      { start: boundaries.s1_end, end: boundaries.s2_end, color: colors.s2 },
      { start: boundaries.s2_end, end: rotated.length - 1, color: colors.s3 },
    ];
    // Draw base track first (so gaps between segments aren't visible)
    ctx.beginPath();
    ctx.strokeStyle = "#3A3A4A";
    ctx.lineWidth = trackWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const [bx, by] = toScreen(rotated[0]);
    ctx.moveTo(bx, by);
    for (let i = 1; i < rotated.length; i++) {
      const [px, py] = toScreen(rotated[i]);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw colored sector segments on top
    for (const seg of segments) {
      ctx.beginPath();
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = trackWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const [sx2, sy2] = toScreen(rotated[seg.start]);
      ctx.moveTo(sx2, sy2);
      for (let i = seg.start + 1; i <= seg.end && i < rotated.length; i++) {
        const [px, py] = toScreen(rotated[i]);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    const effectiveStatus = (sectorFlags && sectorFlags.length > 0 && (trackStatus === "yellow")) ? "green" : trackStatus;
    ctx.strokeStyle = lightTrack && effectiveStatus === "green"
      ? "rgba(255, 255, 255, 0.9)"
      : TRACK_STATUS_COLORS[effectiveStatus] || "#3A3A4A";
    ctx.lineWidth = trackWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const [sx, sy] = toScreen(rotated[0]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < rotated.length; i++) {
      const [px, py] = toScreen(rotated[i]);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Draw track center line (not on a white track)
  ctx.beginPath();
  ctx.strokeStyle = lightTrack ? "rgba(0, 0, 0, 0)" : "#4A4A5A";
  ctx.lineWidth = 2;
  const [sx, sy] = toScreen(rotated[0]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < rotated.length; i++) {
    const [px, py] = toScreen(rotated[i]);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  // Start/finish marker  - drawn perpendicular to track direction
  const [fx, fy] = toScreen(rotated[0]);
  const [nx, ny] = toScreen(rotated[1]);
  const trackAngle = Math.atan2(ny - fy, nx - fx);
  const perpAngle = trackAngle + Math.PI / 2;
  const markerLen = 8;
  ctx.beginPath();
  ctx.moveTo(fx - Math.cos(perpAngle) * markerLen, fy - Math.sin(perpAngle) * markerLen);
  ctx.lineTo(fx + Math.cos(perpAngle) * markerLen, fy + Math.sin(perpAngle) * markerLen);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();

  // Corner labels
  if (corners && corners.length > 0) {
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const c of corners) {
      // Apply same rotation as track points
      const dx = c.x - cx;
      const dy = c.y - cy;
      const rx = dx * cos - dy * sin + cx;
      const ry = dx * sin + dy * cos + cy;
      const [screenX, screenY] = toScreen({ x: rx, y: ry });

      // Offset label away from track using the angle
      const labelRad = ((c.angle + rotation) * Math.PI) / 180;
      const labelOffset = 18;
      const lx = screenX + Math.cos(labelRad) * labelOffset;
      const ly = screenY - Math.sin(labelRad) * labelOffset;

      const label = c.letter ? `${c.number}${c.letter}` : `${c.number}`;

      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fillText(label, lx, ly);
    }
  }

  // Marshal sector flag indicators
  if (marshalSectors && sectorFlags && sectorFlags.length > 0) {
    const flagLookup = new Map<number, SectorFlag>();
    for (const sf of sectorFlags) {
      flagLookup.set(sf.sector, sf);
    }

    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const ms of marshalSectors) {
      const sf = flagLookup.get(ms.number);
      if (!sf) continue;

      const dx = ms.x - cx;
      const dy = ms.y - cy;
      const rx = dx * cos - dy * sin + cx;
      const ry = dx * sin + dy * cos + cy;
      const [screenX, screenY] = toScreen({ x: rx, y: ry });

      // Flag colour
      const isDouble = sf.flag === "DOUBLE YELLOW";
      const flagColor = sf.flag === "RED" ? "#FF0000" : "#FFD700";
      const radius = 8;

      // Dark outline for contrast
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = "#000000";
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Inner circle
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = flagColor;
      ctx.fill();

      // Double yellow — outer ring
      if (isDouble) {
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#B8960F";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw driver abbreviation if present
      if (sf.driver) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(sf.driver, screenX, screenY + radius + 10);
      }
    }
  }
}

export function drawDrivers(
  ctx: CanvasRenderingContext2D,
  drivers: DriverMarker[],
  trackPoints: TrackPoint[],
  width: number,
  height: number,
  rotation: number,
  highlightedDrivers: string[],
  showNames: boolean = true,
) {
  if (trackPoints.length === 0) return;

  const padX = 40;
  const padTop = 60;
  const padBottom = 90;
  const w = width - padX * 2;
  const h = height - padTop - padBottom;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = 0.5;
  const cy = 0.5;

  const rotatedTrack = trackPoints.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotatedTrack) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(w / rangeX, h / rangeY);
  const offsetX = padX + (w - rangeX * scale) / 2;
  const offsetY = padTop + (h - rangeY * scale) / 2;

  for (const drv of drivers) {
    // Rotate driver position
    const dx = drv.x - cx;
    const dy = drv.y - cy;
    const rx = dx * cos - dy * sin + cx;
    const ry = dx * sin + dy * cos + cy;

    const sx = offsetX + (rx - minX) * scale;
    const sy = offsetY + (maxY - ry) * scale; // Flip Y: data Y-up → screen Y-down

    const isHighlighted = highlightedDrivers.includes(drv.abbr);
    const radius = isHighlighted ? 8 : 5;

    ctx.save();

    // Glow effect for highlighted
    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = drv.color + "40";
      ctx.fill();
    }

    // Driver dot
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = drv.color;
    ctx.strokeStyle = drv.color;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Driver label
    if (showNames) {
      ctx.font = isHighlighted ? "800 12px system-ui, -apple-system, sans-serif" : "800 10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(drv.abbr, sx, sy - radius - 4);
    }
  }
}
