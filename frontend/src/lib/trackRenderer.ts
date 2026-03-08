export interface TrackPoint {
  x: number;
  y: number;
}

export interface DriverMarker {
  abbr: string;
  x: number;
  y: number;
  color: string;
  position: number | null;
}

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
) {
  if (points.length === 0) return;

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

  // Draw track outline
  ctx.beginPath();
  ctx.strokeStyle = TRACK_STATUS_COLORS[trackStatus] || "#3A3A4A";
  ctx.lineWidth = 12;
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

  // Draw track center line
  ctx.beginPath();
  ctx.strokeStyle = "#4A4A5A";
  ctx.lineWidth = 2;
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
