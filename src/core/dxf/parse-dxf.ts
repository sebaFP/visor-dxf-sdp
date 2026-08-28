import DxfParser from "dxf-parser";
import {
  EMPTY_BOUNDS,
  boundsOf,
  flattenArc,
  flattenBulge,
  flattenEllipse,
  flattenSpline,
  growBounds,
  isFiniteBounds,
  polygonCentroid,
  signedArea2,
} from "./geometry";
import type {
  Bounds,
  DxfDocument,
  Primitive,
  TextAnchor,
  Vec2,
  ZoneLayer,
  ZoneRing,
} from "./types";
import { BASE_LAYER, parseZoneLayer } from "./zones";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * dxf-parser ships loose types, so raw entities are handled as `any` inside this
 * file only. Everything that leaves `parseDxf` is fully typed.
 */
type RawEntity = any;

const DEG = Math.PI / 180;
const MAX_BLOCK_DEPTH = 4;

export interface ParseOptions {
  /** Layer holding the base drawing. */
  baseLayer?: string;
  /**
   * Fraction of coordinates trimmed from each end when computing `fitBounds`.
   *
   * Real plans routinely contain a stray construction line thousands of units
   * away (the sample plan has exactly one, an ARC at x = -42432) which would
   * otherwise shrink the auto-fit view to a few pixels. 0 disables trimming.
   */
  fitTrim?: number;
}

interface Transform {
  /** Applied as: rotate, then scale, then translate. */
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  cos: number;
  sin: number;
}

const IDENTITY: Transform = { tx: 0, ty: 0, sx: 1, sy: 1, cos: 1, sin: 0 };

function apply(t: Transform, p: { x: number; y: number }): Vec2 {
  const x = p.x * t.sx;
  const y = p.y * t.sy;
  return { x: t.tx + x * t.cos - y * t.sin, y: t.ty + x * t.sin + y * t.cos };
}

function isIdentity(t: Transform): boolean {
  return t === IDENTITY;
}

function vec(p: any): Vec2 | null {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}

/** DXF group code 72 (horizontal justification) -> canvas text alignment. */
function textAnchor(halign: unknown): TextAnchor {
  switch (halign) {
    case 1:
    case 4:
      return "center";
    case 2:
      return "right";
    default:
      return "left";
  }
}

/**
 * MTEXT carries inline formatting codes. We only need the words, so strip the
 * markup rather than pull in a full MTEXT layout engine.
 */
function stripMtextCodes(raw: string): string {
  return raw
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;\\]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\(.)/g, "$1")
    .trim();
}

/** Vertices of an LWPOLYLINE/POLYLINE, with bulges expanded into arc points. */
function polylinePoints(vertices: any[], closed: boolean): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const current = vec(vertices[i]);
    if (!current) continue;
    pts.push(current);

    const isLast = i === vertices.length - 1;
    if (isLast && !closed) break;
    const next = vec(vertices[isLast ? 0 : i + 1]);
    if (!next) continue;

    const bulge = vertices[i].bulge;
    if (bulge) pts.push(...flattenBulge(current, next, bulge));
  }
  return pts;
}

/**
 * Convert one raw entity into zero or more normalized primitives.
 * INSERT recurses into its block definition.
 */
function normalize(
  entity: RawEntity,
  blocks: Record<string, any>,
  transform: Transform,
  layerOverride: string | null,
  depth: number,
  out: Primitive[],
): void {
  const layer = layerOverride ?? entity.layer ?? BASE_LAYER;
  const map = (pts: Vec2[]) => (isIdentity(transform) ? pts : pts.map((p) => apply(transform, p)));
  const emitPath = (pts: Vec2[], closed: boolean) => {
    if (pts.length >= 2) out.push({ kind: "path", layer, points: map(pts), closed });
  };

  switch (entity.type) {
    case "LINE": {
      const [a, b] = entity.vertices ?? [];
      const pa = vec(a);
      const pb = vec(b);
      if (pa && pb) emitPath([pa, pb], false);
      return;
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      const closed = Boolean(entity.shape ?? entity.closed);
      emitPath(polylinePoints(entity.vertices ?? [], closed), closed);
      return;
    }

    case "ARC": {
      const c = vec(entity.center);
      if (!c || !Number.isFinite(entity.radius)) return;
      emitPath(flattenArc(c, entity.radius, entity.startAngle ?? 0, entity.endAngle ?? 0), false);
      return;
    }

    case "ELLIPSE": {
      const c = vec(entity.center);
      const major = vec(entity.majorAxisEndPoint);
      if (!c || !major) return;
      emitPath(
        flattenEllipse(
          c,
          major,
          entity.axisRatio ?? 1,
          entity.startAngle ?? 0,
          entity.endAngle ?? Math.PI * 2,
        ),
        false,
      );
      return;
    }

    case "SPLINE": {
      const cps = (entity.controlPoints ?? []).map(vec).filter(Boolean) as Vec2[];
      if (cps.length < 2) return;
      emitPath(
        flattenSpline(cps, entity.degreeOfSplineCurve ?? 3, entity.knotValues ?? []),
        false,
      );
      return;
    }

    case "CIRCLE": {
      const c = vec(entity.center);
      if (!c || !Number.isFinite(entity.radius)) return;
      // A non-uniform insert scale would turn this into an ellipse; the average
      // radius is a fine approximation and blocks here are uniformly scaled.
      const scale = (Math.abs(transform.sx) + Math.abs(transform.sy)) / 2;
      out.push({
        kind: "circle",
        layer,
        center: isIdentity(transform) ? c : apply(transform, c),
        radius: entity.radius * scale,
      });
      return;
    }

    case "SOLID":
    case "TRACE": {
      const pts = (entity.points ?? []).map(vec).filter(Boolean) as Vec2[];
      // DXF stores SOLID corners in a Z order; swap the last two to get a ring.
      if (pts.length === 4) [pts[2], pts[3]] = [pts[3], pts[2]];
      emitPath(pts, true);
      return;
    }

    case "LEADER": {
      const pts = (entity.vertices ?? []).map(vec).filter(Boolean) as Vec2[];
      emitPath(pts, false);
      return;
    }

    case "TEXT": {
      const at = vec(entity.startPoint);
      const value = String(entity.text ?? "").trim();
      if (!at || !value) return;
      out.push({
        kind: "text",
        layer,
        at: isIdentity(transform) ? at : apply(transform, at),
        text: value,
        height: (entity.textHeight ?? 1) * Math.abs(transform.sy),
        rotationDeg: (entity.rotation ?? 0) + (Math.atan2(transform.sin, transform.cos) / DEG),
        anchor: textAnchor(entity.halign),
      });
      return;
    }

    case "MTEXT": {
      const at = vec(entity.position);
      const value = stripMtextCodes(String(entity.text ?? ""));
      if (!at || !value) return;
      out.push({
        kind: "text",
        layer,
        at: isIdentity(transform) ? at : apply(transform, at),
        text: value,
        height: (entity.height ?? 1) * Math.abs(transform.sy),
        rotationDeg: 0,
        // MTEXT attachment points 2/5/8 are the top/middle/bottom-centre column.
        anchor:
          entity.attachmentPoint && [2, 5, 8].includes(entity.attachmentPoint)
            ? "center"
            : "left",
      });
      return;
    }

    case "INSERT": {
      const block = blocks[entity.name];
      if (!block?.entities?.length || depth >= MAX_BLOCK_DEPTH) return;

      const pos = vec(entity.position) ?? { x: 0, y: 0 };
      const rot = (entity.rotation ?? 0) * DEG;
      const sx = entity.xScale ?? 1;
      const sy = entity.yScale ?? 1;
      const base = vec(block.position) ?? { x: 0, y: 0 };

      // Compose with the parent transform so nested blocks stack correctly.
      const local: Transform = {
        tx: pos.x - base.x * sx,
        ty: pos.y - base.y * sy,
        sx,
        sy,
        cos: Math.cos(rot),
        sin: Math.sin(rot),
      };
      let composed = local;
      if (!isIdentity(transform)) {
        const origin = apply(transform, { x: local.tx, y: local.ty });
        composed = {
          tx: origin.x,
          ty: origin.y,
          sx: local.sx * transform.sx,
          sy: local.sy * transform.sy,
          cos: local.cos * transform.cos - local.sin * transform.sin,
          sin: local.sin * transform.cos + local.cos * transform.sin,
        };
      }

      for (const child of block.entities) {
        // Block children on layer "0" inherit the INSERT's layer, per the spec.
        const childLayer = !child.layer || child.layer === "0" ? layer : child.layer;
        normalize(child, blocks, composed, childLayer, depth + 1, out);
      }
      return;
    }

    // POINT, DIMENSION, HATCH and friends carry no outline we need to draw.
    default:
      return;
  }
}

function primitiveBounds(p: Primitive, into: Bounds): void {
  if (p.kind === "path") {
    for (const pt of p.points) growBounds(into, pt);
  } else if (p.kind === "circle") {
    growBounds(into, { x: p.center.x - p.radius, y: p.center.y - p.radius });
    growBounds(into, { x: p.center.x + p.radius, y: p.center.y + p.radius });
  } else {
    growBounds(into, p.at);
  }
}

/** Percentile bounds, so a single stray entity cannot ruin the auto-fit view. */
function trimmedBounds(primitives: Primitive[], trim: number, fallback: Bounds): Bounds {
  if (trim <= 0) return fallback;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of primitives) {
    const pts = p.kind === "path" ? p.points : [p.kind === "circle" ? p.center : p.at];
    for (const pt of pts) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  }
  if (xs.length < 100) return fallback;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const lo = Math.floor((xs.length - 1) * trim);
  const hi = Math.ceil((xs.length - 1) * (1 - trim));
  return { minX: xs[lo], maxX: xs[hi], minY: ys[lo], maxY: ys[hi] };
}

function buildZoneLayers(byLayer: Map<string, Primitive[]>): {
  zoneLayers: ZoneLayer[];
  ignoredLayers: string[];
} {
  const zoneLayers: ZoneLayer[] = [];
  const ignoredLayers: string[] = [];

  for (const [layer, primitives] of byLayer) {
    const zoneIds = parseZoneLayer(layer);
    if (!zoneIds) {
      ignoredLayers.push(layer);
      continue;
    }

    const rings: ZoneRing[] = [];
    for (const p of primitives) {
      // Zone shapes are polygons. Some are stored open in the DXF (7 of the 21
      // rings in the sample plan) — close them rather than dropping them.
      if (p.kind !== "path" || p.points.length < 3) continue;
      rings.push({
        layer,
        points: p.points,
        bounds: boundsOf(p.points),
        area: Math.abs(signedArea2(p.points)),
      });
    }
    if (rings.length === 0) {
      ignoredLayers.push(layer);
      continue;
    }

    // Anchor the badge on the largest ring so it never lands on a sliver.
    const anchor = rings.reduce((a, b) => (b.area > a.area ? b : a));
    const bounds = { ...EMPTY_BOUNDS };
    for (const r of rings) {
      growBounds(bounds, { x: r.bounds.minX, y: r.bounds.minY });
      growBounds(bounds, { x: r.bounds.maxX, y: r.bounds.maxY });
    }

    zoneLayers.push({
      layer,
      zoneIds,
      rings,
      labelPoint: polygonCentroid(anchor.points),
      bounds,
      focusBounds: anchor.bounds,
    });
  }

  return { zoneLayers, ignoredLayers };
}

/**
 * Parse a DXF string into the normalized document the viewer renders.
 *
 * Synchronous and CPU-bound (~200 ms for a 13 MB plan). Call it inside a Web
 * Worker if you need the main thread free — nothing here touches the DOM.
 */
export function parseDxf(source: string, options: ParseOptions = {}): DxfDocument {
  const { baseLayer = BASE_LAYER, fitTrim = 0.001 } = options;

  const parsed = new DxfParser().parseSync(source);
  if (!parsed) throw new Error("El archivo DXF no pudo ser interpretado.");

  const blocks = (parsed.blocks ?? {}) as Record<string, any>;
  const primitives: Primitive[] = [];
  for (const entity of parsed.entities ?? []) {
    normalize(entity, blocks, IDENTITY, null, 0, primitives);
  }

  const base: Primitive[] = [];
  const byLayer = new Map<string, Primitive[]>();
  const bounds = { ...EMPTY_BOUNDS };

  for (const p of primitives) {
    primitiveBounds(p, bounds);
    if (p.layer === baseLayer) {
      base.push(p);
    } else {
      const bucket = byLayer.get(p.layer);
      if (bucket) bucket.push(p);
      else byLayer.set(p.layer, [p]);
    }
  }

  const safeBounds = isFiniteBounds(bounds)
    ? bounds
    : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const { zoneLayers, ignoredLayers } = buildZoneLayers(byLayer);

  return {
    base,
    zoneLayers,
    bounds: safeBounds,
    fitBounds: trimmedBounds(primitives, fitTrim, safeBounds),
    ignoredLayers,
  };
}

/** Fetch + parse in one step. */
export async function loadDxf(url: string, options?: ParseOptions): Promise<DxfDocument> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status})`);
  return parseDxf(await res.text(), options);
}
