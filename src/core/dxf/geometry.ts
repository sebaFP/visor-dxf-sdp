import type { Bounds, Vec2 } from "./types";

export const EMPTY_BOUNDS: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

export function growBounds(b: Bounds, p: Vec2): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.y > b.maxY) b.maxY = p.y;
}

export function boundsOf(points: Vec2[]): Bounds {
  const b = { ...EMPTY_BOUNDS };
  for (const p of points) growBounds(b, p);
  return b;
}

export function isFiniteBounds(b: Bounds): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY)
  );
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function containsPoint(b: Bounds, p: Vec2): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** How many segments to use when flattening a curve of the given radius/sweep. */
function arcSegments(sweepRad: number): number {
  return Math.max(2, Math.min(96, Math.ceil(Math.abs(sweepRad) / 0.12)));
}

/** Sample an arc counter-clockwise from `start` to `end` (radians). */
export function flattenArc(
  center: Vec2,
  radius: number,
  startRad: number,
  endRad: number,
): Vec2[] {
  let sweep = endRad - startRad;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = arcSegments(sweep);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = startRad + (sweep * i) / n;
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Expand a DXF "bulge" between two polyline vertices into arc points.
 *
 * bulge = tan(sweep / 4). Positive is counter-clockwise. Returns the intermediate
 * points only — the caller already emitted `from` and will emit `to`.
 */
export function flattenBulge(from: Vec2, to: Vec2, bulge: number): Vec2[] {
  if (!bulge || !Number.isFinite(bulge)) return [];
  const sweep = 4 * Math.atan(bulge);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [];

  const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  if (!Number.isFinite(radius)) return [];

  // Centre sits on the perpendicular bisector of the chord.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
  const sign = sweep > 0 ? 1 : -1;
  const cx = midX - (sign * h * dy) / chord;
  const cy = midY + (sign * h * dx) / chord;

  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const n = arcSegments(sweep);
  const out: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/** Flatten a (possibly rotated) ellipse arc, DXF style. */
export function flattenEllipse(
  center: Vec2,
  majorAxisEnd: Vec2,
  axisRatio: number,
  startRad: number,
  endRad: number,
): Vec2[] {
  const majorLen = Math.hypot(majorAxisEnd.x, majorAxisEnd.y);
  if (majorLen === 0) return [];
  const minorLen = majorLen * axisRatio;
  const rot = Math.atan2(majorAxisEnd.y, majorAxisEnd.x);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  let sweep = endRad - startRad;
  if (Math.abs(sweep) < 1e-9) sweep = Math.PI * 2;
  while (sweep <= 0) sweep += Math.PI * 2;

  const n = arcSegments(sweep);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = startRad + (sweep * i) / n;
    const px = majorLen * Math.cos(a);
    const py = minorLen * Math.sin(a);
    out.push({ x: center.x + px * cos - py * sin, y: center.y + px * sin + py * cos });
  }
  return out;
}

/**
 * Approximate a B-spline with a uniform de Boor evaluation.
 *
 * Splines are rare in architectural plans (5 in the sample plan) and only ever
 * decorative here, so a coarse sample is plenty. Falls back to the control
 * polygon if the knot vector is malformed.
 */
export function flattenSpline(
  controlPoints: Vec2[],
  degree: number,
  knots: number[],
  samples = 64,
): Vec2[] {
  const n = controlPoints.length;
  const p = Math.min(degree, n - 1);
  if (n < 2 || p < 1 || knots.length !== n + p + 1) return controlPoints;

  const domainStart = knots[p];
  const domainEnd = knots[n];
  if (!(domainEnd > domainStart)) return controlPoints;

  const out: Vec2[] = [];
  for (let s = 0; s <= samples; s++) {
    const u = domainStart + ((domainEnd - domainStart) * s) / samples;

    let k = p;
    while (k < n - 1 && u >= knots[k + 1]) k++;

    const d = controlPoints.slice(k - p, k + 1).map((c) => ({ x: c.x, y: c.y }));
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const denom = knots[i + p - r + 1] - knots[i];
        const alpha = denom === 0 ? 0 : (u - knots[i]) / denom;
        d[j] = {
          x: d[j - 1].x * (1 - alpha) + d[j].x * alpha,
          y: d[j - 1].y * (1 - alpha) + d[j].y * alpha,
        };
      }
    }
    out.push(d[p]);
  }
  return out;
}

/** Signed area x 2. Positive when the ring winds counter-clockwise. */
export function signedArea2(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return sum;
}

/**
 * Centroid of a closed ring. Falls back to the vertex average for degenerate
 * (zero-area) rings so a label always has somewhere to sit.
 */
export function polygonCentroid(points: Vec2[]): Vec2 {
  const a2 = signedArea2(points);
  if (Math.abs(a2) < 1e-9) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** Standard even-odd ray cast. */
export function pointInPolygon(point: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y;
    const yj = ring[j].y;
    if (yi > point.y !== yj > point.y) {
      const xAt = ring[i].x + ((point.y - yi) / (yj - yi)) * (ring[j].x - ring[i].x);
      if (point.x < xAt) inside = !inside;
    }
  }
  return inside;
}
