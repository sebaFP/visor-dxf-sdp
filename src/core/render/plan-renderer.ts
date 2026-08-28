import { boundsIntersect, containsPoint, pointInPolygon } from "../dxf/geometry";
import type { Bounds, DxfDocument, Primitive, TextPrimitive, Vec2 } from "../dxf/types";
import { DARK_THEME, rampColor, type PlanTheme } from "./theme";
import { visibleBounds, type Viewport } from "./viewport";

/**
 * Canvas 2D renderer for a normalized DXF document.
 *
 * Deliberately not React and not WebGL:
 *  - the base drawing (36k entities in the sample plan) is baked ONCE into a
 *    handful of Path2D objects, so a pan/zoom frame is a few stroke() calls
 *    instead of 36k of them;
 *  - no three.js means no GPU context to lose, no 600 kB dependency, and any
 *    framework can drop this into a <canvas>.
 *
 * Text is the only per-frame per-item work, and it is culled by viewport and by
 * on-screen size before anything is measured.
 */

/** Below this on-screen cap height, text is illegible — skip it entirely. */
const MIN_TEXT_PX = 6;
/** Above this, we stop drawing base geometry hairlines and thicken slightly. */
const BASE_LINE_PX = 1;

export interface ZoneStyle {
  /** 0..1 density used to sample the colour ramp. */
  intensity: number;
  /** Zone has nobody in it — painted flat instead of sampled from the ramp. */
  empty: boolean;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
}

export interface RenderState {
  viewport: Viewport;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  /** Per-layer styling. Layers missing from the map are drawn as empty. */
  zoneStyles: Map<string, ZoneStyle>;
  showBaseText: boolean;
}

interface BakedZone {
  layer: string;
  path: Path2D;
  bounds: Bounds;
  rings: Vec2[][];
}

/**
 * Pre-baked geometry. Building this is the expensive step (~50 ms for a 13 MB
 * plan); it happens once per document, not once per frame.
 */
export class PlanRenderer {
  private readonly baseGeometry: Path2D;
  private readonly baseTexts: TextPrimitive[];
  private readonly zones: BakedZone[];
  private readonly theme: PlanTheme;

  constructor(doc: DxfDocument, theme: PlanTheme = DARK_THEME) {
    this.theme = theme;
    this.baseGeometry = new Path2D();
    this.baseTexts = [];

    for (const primitive of doc.base) {
      if (primitive.kind === "text") this.baseTexts.push(primitive);
      else addToPath(this.baseGeometry, primitive);
    }

    this.zones = doc.zoneLayers.map((zl) => {
      const path = new Path2D();
      for (const ring of zl.rings) {
        traceRing(path, ring.points);
      }
      return {
        layer: zl.layer,
        path,
        bounds: zl.bounds,
        rings: zl.rings.map((r) => r.points),
      };
    });
  }

  render(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const { viewport: vp, width, height } = state;
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);

    // World space: Y is flipped so DXF "up" stays up.
    ctx.setTransform(dpr * vp.scale, 0, 0, -dpr * vp.scale, dpr * vp.tx, dpr * vp.ty);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = this.theme.baseStroke;
    ctx.lineWidth = BASE_LINE_PX / vp.scale;
    ctx.stroke(this.baseGeometry);

    this.drawZones(ctx, state);

    // Text is drawn back in screen space so glyphs are not mirrored by the flip.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.showBaseText) this.drawBaseText(ctx, state);
  }

  private drawZones(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const { viewport: vp } = state;
    const view = visibleBounds(vp, state.width, state.height);
    const { theme } = this;

    // Selected/hovered zones stroke last so their outline is never overdrawn.
    const emphasised: BakedZone[] = [];

    for (const zone of this.zones) {
      if (!boundsIntersect(zone.bounds, view)) continue;
      const style = state.zoneStyles.get(zone.layer);
      const alpha = style?.dimmed ? theme.dimmedAlpha : 1;

      ctx.globalAlpha = alpha;
      ctx.fillStyle =
        !style || style.empty
          ? theme.emptyFill
          : rampColor(theme.densityRamp, style.intensity, 0.55);
      ctx.fill(zone.path, "evenodd");

      if (style?.selected || style?.hovered) {
        emphasised.push(zone);
      } else {
        ctx.strokeStyle = theme.zoneStroke;
        ctx.lineWidth = 1.25 / vp.scale;
        ctx.stroke(zone.path);
      }
    }

    for (const zone of emphasised) {
      const style = state.zoneStyles.get(zone.layer)!;
      ctx.globalAlpha = style.dimmed ? theme.dimmedAlpha : 1;
      ctx.strokeStyle = style.selected ? theme.zoneStrokeSelected : theme.zoneStrokeHover;
      ctx.lineWidth = (style.selected ? 3 : 2) / vp.scale;
      ctx.stroke(zone.path);
    }

    ctx.globalAlpha = 1;
  }

  private drawBaseText(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const { viewport: vp } = state;
    const view = visibleBounds(vp, state.width, state.height);

    ctx.fillStyle = this.theme.baseText;
    ctx.textBaseline = "alphabetic";

    for (const t of this.baseTexts) {
      const px = t.height * vp.scale;
      if (px < MIN_TEXT_PX) continue;
      if (!containsPoint(view, t.at)) continue;

      const sx = t.at.x * vp.scale + vp.tx;
      const sy = -t.at.y * vp.scale + vp.ty;

      ctx.save();
      ctx.translate(sx, sy);
      // Canvas Y grows downward, so a CCW world rotation is CW on screen.
      if (t.rotationDeg) ctx.rotate((-t.rotationDeg * Math.PI) / 180);
      ctx.font = `${px.toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = t.anchor === "left" ? "left" : t.anchor === "right" ? "right" : "center";
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Topmost zone layer containing a world point, or null.
   * Smallest-area-first so a zone nested inside another still wins the click.
   */
  hitTest(world: Vec2): string | null {
    let best: { layer: string; area: number } | null = null;

    for (const zone of this.zones) {
      if (!containsPoint(zone.bounds, world)) continue;
      for (const ring of zone.rings) {
        if (!pointInPolygon(world, ring)) continue;
        const area = (zone.bounds.maxX - zone.bounds.minX) * (zone.bounds.maxY - zone.bounds.minY);
        if (!best || area < best.area) best = { layer: zone.layer, area };
        break;
      }
    }
    return best?.layer ?? null;
  }
}

function traceRing(path: Path2D, points: Vec2[]): void {
  if (points.length < 2) return;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();
}

function addToPath(path: Path2D, primitive: Primitive): void {
  if (primitive.kind === "circle") {
    path.moveTo(primitive.center.x + primitive.radius, primitive.center.y);
    path.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2);
    return;
  }
  if (primitive.kind !== "path") return;

  const pts = primitive.points;
  if (pts.length < 2) return;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  if (primitive.closed) path.closePath();
}
