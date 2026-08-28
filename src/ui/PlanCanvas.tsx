import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DxfDocument, Vec2 } from "../core/dxf/types";
import type { OccupancySnapshot } from "../core/occupancy/types";
import { PlanRenderer, type ZoneStyle } from "../core/render/plan-renderer";
import { DARK_THEME, rampColor } from "../core/render/theme";
import {
  fitBounds,
  focusBounds,
  lerpViewport,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Viewport,
} from "../core/render/viewport";

/** Drag further than this (px) and the pointer-up is a pan, not a click. */
const CLICK_SLOP = 4;
const ZOOM_STEP = 1.25;
/**
 * Minimum screen distance between two count badges. The sample plan stacks four
 * levels vertically, so zoomed out a dozen badges land on the same 40 px — the
 * busiest zone wins and the rest are hidden until you zoom in.
 */
const BADGE_MIN_DISTANCE = 44;
const CAMERA_MS = 320;

export interface PlanCanvasProps {
  doc: DxfDocument;
  occupancy: OccupancySnapshot;
  selectedLayer: string | null;
  onSelectLayer: (layer: string | null) => void;
  /** When set, layers outside the set are dimmed. */
  highlightLayers?: Set<string> | null;
  showBaseText: boolean;
}

interface Badge {
  layer: string;
  zoneIds: string[];
  count: number;
  x: number;
  y: number;
}

export function PlanCanvas({
  doc,
  occupancy,
  selectedLayer,
  onSelectLayer,
  highlightLayers = null,
  showBaseText,
}: PlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  const frameRef = useRef(0);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  // Badges live in React state because they are HTML, not canvas — crisp text,
  // real hover/focus, and keyboard reachable for free.
  const [badges, setBadges] = useState<Badge[]>([]);

  const renderer = useMemo(() => new PlanRenderer(doc, DARK_THEME), [doc]);

  const zoneStyles = useMemo(() => {
    const styles = new Map<string, ZoneStyle>();
    for (const zl of doc.zoneLayers) {
      const bucket = occupancy.byLayer.get(zl.layer);
      const count = bucket?.count ?? 0;
      styles.set(zl.layer, {
        intensity: occupancy.maxLayerCount > 0 ? count / occupancy.maxLayerCount : 0,
        empty: count === 0,
        selected: zl.layer === selectedLayer,
        hovered: zl.layer === hoveredLayer,
        dimmed: highlightLayers !== null && !highlightLayers.has(zl.layer),
      });
    }
    return styles;
  }, [doc, occupancy, selectedLayer, hoveredLayer, highlightLayers]);

  const recomputeBadges = useCallback(() => {
    const vp = viewportRef.current;
    const { width, height } = size;
    if (width === 0) return;

    const candidates: Badge[] = [];
    for (const zl of doc.zoneLayers) {
      const p = worldToScreen(vp, zl.labelPoint);
      // Keep a small margin so a badge half off-screen still shows.
      if (p.x < -80 || p.x > width + 80 || p.y < -40 || p.y > height + 40) continue;
      const bucket = occupancy.byLayer.get(zl.layer);
      candidates.push({
        layer: zl.layer,
        zoneIds: zl.zoneIds,
        count: bucket?.count ?? 0,
        x: p.x,
        y: p.y,
      });
    }

    // Busiest first, plus whatever is selected, so suppression never hides the
    // zone the user is actually looking at.
    candidates.sort((a, b) => {
      if (a.layer === selectedLayer) return -1;
      if (b.layer === selectedLayer) return 1;
      return b.count - a.count;
    });

    const next: Badge[] = [];
    for (const badge of candidates) {
      const collides = next.some(
        (placed) => Math.hypot(placed.x - badge.x, placed.y - badge.y) < BADGE_MIN_DISTANCE,
      );
      if (!collides) next.push(badge);
    }
    setBadges(next);
  }, [doc, occupancy, size, selectedLayer]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.width === 0) return;

    renderer.render(ctx, {
      viewport: viewportRef.current,
      width: size.width,
      height: size.height,
      zoneStyles,
      showBaseText,
    });
  }, [renderer, size, zoneStyles, showBaseText]);

  // Animation loops outlive the render that started them, so they must read the
  // CURRENT draw/badge functions. Capturing them instead would repaint the frame
  // with whatever occupancy data happened to exist when the animation began.
  const paintRef = useRef({ draw, recomputeBadges });
  paintRef.current = { draw, recomputeBadges };

  /** Coalesce pan/zoom bursts into one paint per animation frame. */
  const scheduleDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      paintRef.current.draw();
      paintRef.current.recomputeBadges();
    });
  }, []);

  // Track container size (and DPR) for a sharp canvas.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    scheduleDraw();
  }, [size, scheduleDraw]);

  /** Ease the camera to a target viewport instead of teleporting. */
  const animateTo = useCallback((target: Viewport) => {
    const from = viewportRef.current;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / CAMERA_MS);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      viewportRef.current = lerpViewport(from, target, eased);
      paintRef.current.draw();
      paintRef.current.recomputeBadges();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const resetView = useCallback(() => {
    if (size.width === 0) return;
    animateTo(fitBounds(doc.fitBounds, size.width, size.height, 48));
  }, [doc, size, animateTo]);

  // Fly to a zone when it becomes the selection, but only if it is off-screen
  // or too small to read — otherwise the view jumping around is just annoying.
  //
  // The key includes the canvas size because opening the detail panel shrinks
  // the canvas, which can push a just-focused zone off the bottom edge. One
  // re-focus per size change, never a loop: the key is written before animating.
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLayer || size.width === 0) {
      focusKeyRef.current = null;
      return;
    }
    const key = `${selectedLayer}@${size.width}x${size.height}`;
    if (focusKeyRef.current === key) return;
    focusKeyRef.current = key;

    const zone = doc.zoneLayers.find((zl) => zl.layer === selectedLayer);
    if (!zone) return;

    const target = zone.focusBounds;
    const vp = viewportRef.current;
    const topLeft = worldToScreen(vp, { x: target.minX, y: target.maxY });
    const bottomRight = worldToScreen(vp, { x: target.maxX, y: target.minY });
    const onScreen =
      topLeft.x > 0 &&
      topLeft.y > 0 &&
      bottomRight.x < size.width &&
      bottomRight.y < size.height;
    const bigEnough = bottomRight.x - topLeft.x > 90 && bottomRight.y - topLeft.y > 90;
    if (onScreen && bigEnough) return;

    animateTo(focusBounds(target, size.width, size.height));
  }, [selectedLayer, doc, size, animateTo]);

  // Fit once the plan and the container are both known.
  const fittedRef = useRef<DxfDocument | null>(null);
  useEffect(() => {
    if (size.width === 0) return;
    if (fittedRef.current === doc) return;
    fittedRef.current = doc;
    resetView();
  }, [doc, size, resetView]);

  // Repaint whenever anything the renderer reads changes.
  useEffect(scheduleDraw, [scheduleDraw, draw, recomputeBadges]);

  // Wheel must be a non-passive native listener to preventDefault the page zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.pow(ZOOM_STEP, -event.deltaY / 100);
      viewportRef.current = zoomAt(viewportRef.current, anchor, factor);
      scheduleDraw();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scheduleDraw]);

  const localPoint = (event: React.PointerEvent): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = localPoint(event);
    dragRef.current = { x: p.x, y: p.y, moved: 0 };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(event);
    const drag = dragRef.current;

    if (drag) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = p.x;
      drag.y = p.y;
      viewportRef.current = panBy(viewportRef.current, dx, dy);
      scheduleDraw();
      return;
    }

    const layer = renderer.hitTest(screenToWorld(viewportRef.current, p));
    if (layer !== hoveredLayer) setHoveredLayer(layer);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved > CLICK_SLOP) return;

    const world = screenToWorld(viewportRef.current, localPoint(event));
    const layer = renderer.hitTest(world);
    onSelectLayer(layer === selectedLayer ? null : layer);
  };

  const zoomFromButton = (factor: number) => {
    viewportRef.current = zoomAt(
      viewportRef.current,
      { x: size.width / 2, y: size.height / 2 },
      factor,
    );
    scheduleDraw();
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-canvas">
      <canvas
        ref={canvasRef}
        className={hoveredLayer ? "cursor-pointer" : "cursor-grab"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoveredLayer(null)}
      />

      <div className="pointer-events-none absolute inset-0">
        {badges.map((badge) => (
          <ZoneBadge
            key={badge.layer}
            badge={badge}
            max={occupancy.maxLayerCount}
            selected={badge.layer === selectedLayer}
            dimmed={highlightLayers !== null && !highlightLayers.has(badge.layer)}
            onSelect={() => onSelectLayer(badge.layer === selectedLayer ? null : badge.layer)}
            onHover={setHoveredLayer}
          />
        ))}
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <ViewButton label="Acercar" onClick={() => zoomFromButton(ZOOM_STEP)}>+</ViewButton>
        <ViewButton label="Alejar" onClick={() => zoomFromButton(1 / ZOOM_STEP)}>−</ViewButton>
        <ViewButton label="Ajustar a la vista" onClick={resetView}>⤢</ViewButton>
      </div>
    </div>
  );
}

function ZoneBadge({
  badge,
  max,
  selected,
  dimmed,
  onSelect,
  onHover,
}: {
  badge: Badge;
  max: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onHover: (layer: string | null) => void;
}) {
  const intensity = max > 0 ? badge.count / max : 0;
  const empty = badge.count === 0;
  const accent = empty ? "#3d4a58" : rampColor(DARK_THEME.densityRamp, intensity);

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() => onHover(badge.layer)}
      onPointerLeave={() => onHover(null)}
      style={{
        left: badge.x,
        top: badge.y,
        borderColor: selected ? "#f1f5f9" : accent,
        opacity: dimmed ? 0.2 : 1,
      }}
      className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-stretch overflow-hidden rounded-sm border bg-abyss/90 backdrop-blur-[2px] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      title={`Zonas ${badge.zoneIds.join(", ")} — ${badge.count} persona(s)`}
    >
      {/* Franja de color a la izquierda en vez de teñir el número: el conteo
          queda siempre legible y la densidad se lee igual de rápido. */}
      <span aria-hidden className="w-1 shrink-0" style={{ backgroundColor: accent }} />
      <span className="flex flex-col justify-center px-1.5 py-1">
        <span
          className={`tnum block font-mono text-[13px] leading-none font-semibold ${
            empty ? "text-ink-dim" : "text-ink"
          }`}
        >
          {badge.count}
        </span>
        <span className="mt-1 block font-mono text-[9px] leading-none text-ink-dim">
          {badge.layer}
        </span>
      </span>
    </button>
  );
}

function ViewButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-sm border border-line bg-panel/90 text-ink-soft backdrop-blur-[2px] transition-colors hover:border-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      {children}
    </button>
  );
}
