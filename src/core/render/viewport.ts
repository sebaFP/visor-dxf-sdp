import type { Bounds, Vec2 } from "../dxf/types";

/**
 * World -> screen mapping.
 *
 * screenX = worldX * scale + tx
 * screenY = -worldY * scale + ty     (DXF Y points up, canvas Y points down)
 *
 * Plain data, so it is trivially serialisable and testable.
 */
export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export const MIN_SCALE = 1e-4;
export const MAX_SCALE = 1e4;

export function fitBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 32,
): Viewport {
  // Bounds vacíos o infinitos (un DXF sin geometría) darían NaN, y un NaN en
  // la cámara no se recupera nunca: cada pan/zoom lo arrastra.
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return { scale: 1, tx: width / 2, ty: height / 2 };
  }
  const w = Math.max(1e-6, bounds.maxX - bounds.minX);
  const h = Math.max(1e-6, bounds.maxY - bounds.minY);
  // Con un lienzo más chico que el margen se encuadra sin margen: mejor un
  // plano apretado que uno colapsado a un punto.
  const innerW = width - padding * 2 > 0 ? width - padding * 2 : Math.max(1, width);
  const innerH = height - padding * 2 > 0 ? height - padding * 2 : Math.max(1, height);
  const scale = clampScale(Math.min(innerW / w, innerH / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 + cy * scale };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(vp: Viewport, p: Vec2): Vec2 {
  return { x: p.x * vp.scale + vp.tx, y: -p.y * vp.scale + vp.ty };
}

export function screenToWorld(vp: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - vp.tx) / vp.scale, y: -(p.y - vp.ty) / vp.scale };
}

/** Zoom keeping the world point under `anchor` (screen px) pinned in place. */
export function zoomAt(vp: Viewport, anchor: Vec2, factor: number): Viewport {
  const scale = clampScale(vp.scale * factor);
  const applied = scale / vp.scale;
  return {
    scale,
    tx: anchor.x - (anchor.x - vp.tx) * applied,
    ty: anchor.y - (anchor.y - vp.ty) * applied,
  };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, tx: vp.tx + dx, ty: vp.ty + dy };
}

/**
 * Frame a sub-region of the drawing, but never zoom in past `maxScale`.
 *
 * Used when the user picks a zone: a 3 m x 3 m zone would otherwise fill the
 * screen at a scale where the surrounding plan is meaningless.
 */
export function focusBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 120,
  maxScale = 6,
): Viewport {
  const fitted = fitBounds(bounds, width, height, padding);
  if (fitted.scale <= maxScale) return fitted;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale: maxScale, tx: width / 2 - cx * maxScale, ty: height / 2 + cy * maxScale };
}

/** Linear blend between two viewports, for camera animation. */
export function lerpViewport(from: Viewport, to: Viewport, t: number): Viewport {
  return {
    scale: from.scale + (to.scale - from.scale) * t,
    tx: from.tx + (to.tx - from.tx) * t,
    ty: from.ty + (to.ty - from.ty) * t,
  };
}

/** World-space rectangle currently visible, for culling. */
export function visibleBounds(vp: Viewport, width: number, height: number): Bounds {
  const a = screenToWorld(vp, { x: 0, y: 0 });
  const b = screenToWorld(vp, { x: width, y: height });
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}
