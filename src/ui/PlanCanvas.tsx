import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DxfDocument, Vec2 } from "../core/dxf/types";
import type { OccupancySnapshot } from "../core/occupancy/types";
import {
  formatZoneLabels,
  RAW_ZONE_LABEL,
  type ZoneLabeller,
} from "../core/occupancy/zone-names";
import {
  clusterBadges,
  type BadgeCandidate,
  type BadgeCluster,
} from "../core/render/badge-clusters";
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
/** Step used by the buttons — coarser than the wheel so one click is felt. */
const BUTTON_ZOOM_STEP = 1.6;
/**
 * Footprint of one count badge on screen (the widest label plus its stripe).
 * Two badges closer than this in both axes would overlap, so they merge into
 * one that adds up their people, and split again as you zoom in. See
 * `core/render/badge-clusters.ts`.
 */
const BADGE_FOOTPRINT = { width: 132, height: 48 };
const CAMERA_MS = 320;
/** Padding used when framing the whole drawing. Also the 1x of the zoom read-out. */
const FIT_PADDING = 48;

/**
 * Los recorridos se cargan aparte: son modos secundarios y no tienen por qué
 * pesar en el bundle de quien solo mira el plano.
 */
const PerspectiveView = lazy(() => import("./PerspectiveView"));
const OverheadView = lazy(() => import("./OverheadView"));

type PlanMode = "perspective" | "overhead";

const SEQUENCE_PREFIX = [
  "arrowup", "arrowup", "arrowdown", "arrowdown",
  "arrowleft", "arrowright", "arrowleft", "arrowright",
];

/**
 * Secuencias que abren cada recorrido. Comparten las ocho primeras teclas y solo
 * se diferencian en el orden de las dos últimas.
 */
const MODE_SEQUENCES: [PlanMode, string[]][] = [
  ["perspective", [...SEQUENCE_PREFIX, "b", "a"]],
  ["overhead", [...SEQUENCE_PREFIX, "a", "b"]],
];

const SEQUENCE_LENGTH = SEQUENCE_PREFIX.length + 2;

export interface PlanCanvasProps {
  doc: DxfDocument;
  occupancy: OccupancySnapshot;
  selectedLayer: string | null;
  onSelectLayer: (layer: string | null) => void;
  /** When set, layers outside the set are dimmed. */
  highlightLayers?: Set<string> | null;
  showBaseText: boolean;
  /** Human zone label: description -> name -> id. */
  zoneLabel?: ZoneLabeller;
}

export function PlanCanvas({
  doc,
  occupancy,
  selectedLayer,
  onSelectLayer,
  highlightLayers = null,
  showBaseText,
  zoneLabel = RAW_ZONE_LABEL,
}: PlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);
  const frameRef = useRef(0);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  /** Capas de la insignia agrupada bajo el cursor: se resaltan todas. */
  const [hoveredCluster, setHoveredCluster] = useState<readonly string[] | null>(null);
  // Badges live in React state because they are HTML, not canvas — crisp text,
  // real hover/focus, and keyboard reachable for free.
  const [badges, setBadges] = useState<BadgeCluster[]>([]);
  // El DPR cambia al arrastrar la ventana a otro monitor o al hacer zoom en el
  // navegador; el backing store del canvas tiene que seguirlo.
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  /** Current scale as a multiple of "the whole plan fits on screen". */
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<PlanMode | null>(null);
  /**
   * Las últimas teclas pulsadas.
   *
   * Un índice de progreso bastaba con una sola secuencia, pero con dos que
   * comparten prefijo hay que llegar a la novena tecla sin haber apostado por
   * ninguna. Guardar la cola y compararla es indiferente a cuántas haya.
   */
  const keyLogRef = useRef<string[]>([]);

  const renderer = useMemo(() => new PlanRenderer(doc, DARK_THEME), [doc]);

  /** The "everything visible" camera. Null until the container is measured. */
  const fitViewport = useMemo(
    () =>
      size.width > 0
        ? fitBounds(doc.fitBounds, size.width, size.height, FIT_PADDING)
        : null,
    [doc, size],
  );

  const zoneStyles = useMemo(() => {
    const styles = new Map<string, ZoneStyle>();
    for (const zl of doc.zoneLayers) {
      const bucket = occupancy.byLayer.get(zl.layer);
      const count = bucket?.count ?? 0;
      styles.set(zl.layer, {
        intensity: occupancy.maxLayerCount > 0 ? count / occupancy.maxLayerCount : 0,
        empty: count === 0,
        selected: zl.layer === selectedLayer,
        hovered: zl.layer === hoveredLayer || (hoveredCluster?.includes(zl.layer) ?? false),
        dimmed: highlightLayers !== null && !highlightLayers.has(zl.layer),
      });
    }
    return styles;
  }, [doc, occupancy, selectedLayer, hoveredLayer, hoveredCluster, highlightLayers]);

  const recomputeBadges = useCallback(() => {
    const vp = viewportRef.current;
    const { width, height } = size;
    if (width === 0) return;

    // El indicador de zoom se refresca acá y no en su propio efecto: este paso
    // ya provoca un render por frame, así que no cuesta nada extra.
    if (fitViewport) setZoom(vp.scale / fitViewport.scale);

    const candidates: BadgeCandidate[] = [];
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
        focus: zl.focusBounds,
        people: bucket?.people ?? [],
      });
    }

    // Las que se amontonan se suman en una sola insignia; la seleccionada
    // nunca se absorbe, así el grupo jamás esconde lo que el usuario mira.
    setBadges(clusterBadges(candidates, BADGE_FOOTPRINT, selectedLayer));
  }, [doc, occupancy, size, selectedLayer, fitViewport]);

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
      dpr,
    });
  }, [renderer, size, zoneStyles, showBaseText, dpr]);

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

  // Un media query que deja de coincidir en cuanto el DPR cambia; se vuelve a
  // suscribir con el valor nuevo.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    scheduleDraw();
  }, [size, dpr, scheduleDraw]);

  /** Ease the camera to a target viewport instead of teleporting. */
  const cameraFrameRef = useRef(0);
  const animateTo = useCallback((target: Viewport) => {
    const from = viewportRef.current;
    const start = performance.now();
    // Una animación nueva reemplaza a la anterior: dos a la vez se pelearían
    // por la cámara.
    cancelAnimationFrame(cameraFrameRef.current);
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / CAMERA_MS);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      viewportRef.current = lerpViewport(from, target, eased);
      paintRef.current.draw();
      paintRef.current.recomputeBadges();
      cameraFrameRef.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    cameraFrameRef.current = requestAnimationFrame(step);
  }, []);

  // Nada debe seguir pintando un canvas que ya no existe. Los handles vuelven
  // a 0: en StrictMode React desmonta y vuelve a montar, y un handle cancelado
  // que quedara guardado haría creer a `scheduleDraw` que ya hay un frame
  // pendiente — y no se pintaría nunca más.
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(cameraFrameRef.current);
      frameRef.current = 0;
      cameraFrameRef.current = 0;
    },
    [],
  );

  /** Acercar hasta que las capas de una insignia agrupada se separen. */
  const focusCluster = useCallback(
    (cluster: BadgeCluster) => {
      if (size.width === 0) return;
      animateTo(focusBounds(cluster.focus, size.width, size.height));
    },
    [size, animateTo],
  );

  const resetView = useCallback(() => {
    if (fitViewport) animateTo(fitViewport);
  }, [fitViewport, animateTo]);

  const zoneFor = useCallback(
    (layer: string) => doc.zoneLayers.find((zl) => zl.layer === layer) ?? null,
    [doc],
  );

  /** Frame the selected zone on demand — the button under "ajustar al plano". */
  const focusSelection = useCallback(() => {
    if (!selectedLayer || size.width === 0) return;
    const zone = zoneFor(selectedLayer);
    if (!zone) return;
    animateTo(focusBounds(zone.focusBounds, size.width, size.height));
  }, [selectedLayer, size, zoneFor, animateTo]);

  /** Zoom around the middle of the canvas, which is what a button implies. */
  const zoomFromButton = useCallback(
    (factor: number) => {
      if (size.width === 0) return;
      viewportRef.current = zoomAt(
        viewportRef.current,
        { x: size.width / 2, y: size.height / 2 },
        factor,
      );
      scheduleDraw();
    },
    [size, scheduleDraw],
  );

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

  // Atajos sobre el plano. El contenedor es focusable, así que solo actúan
  // cuando el plano tiene el foco: nunca le roban una tecla al filtro de la
  // tabla ni a un input del resto de la aplicación.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Los recorridos tienen sus propios controles: sin esto, moverse en ellos
    // también movería la cámara del plano que queda debajo.
    if (mode) return;

    const log = keyLogRef.current;
    log.push(event.key.toLowerCase());
    if (log.length > SEQUENCE_LENGTH) log.shift();

    if (log.length === SEQUENCE_LENGTH) {
      const matched = MODE_SEQUENCES.find(([, seq]) => seq.every((key, i) => key === log[i]));
      if (matched) {
        log.length = 0;
        setMode(matched[0]);
      }
    }

    if (event.key === "+" || event.key === "=") zoomFromButton(BUTTON_ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomFromButton(1 / BUTTON_ZOOM_STEP);
    else if (event.key === "0") resetView();
    else if (event.key === "f" || event.key === "F") focusSelection();
    else return;
    event.preventDefault();
  };

  const localPoint = (event: React.PointerEvent): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // El canvas no es focusable y la captura de puntero se come el enfoque por
    // defecto, así que el contenedor nunca lo recibía: los atajos del plano
    // (+, −, 0, F) solo funcionaban si se llegaba a él con el tabulador.
    containerRef.current?.focus({ preventScroll: true });
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

  const selectedZone = selectedLayer ? zoneFor(selectedLayer) : null;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative h-full w-full overflow-hidden bg-canvas focus:outline-none"
    >
      <canvas
        ref={canvasRef}
        className={hoveredLayer ? "cursor-pointer" : "cursor-grab"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoveredLayer(null)}
      />

      <div className="pointer-events-none absolute inset-0">
        {badges.map((badge) => {
          const grouped = badge.layers.length > 1;
          const layer = badge.layers[0];
          return (
            <ZoneBadge
              key={badge.key}
              badge={badge}
              max={occupancy.maxLayerCount}
              selected={!grouped && layer === selectedLayer}
              dimmed={
                highlightLayers !== null && !badge.layers.some((l) => highlightLayers.has(l))
              }
              label={
                grouped
                  ? `${badge.layers.length} zonas agrupadas`
                  : formatZoneLabels(badge.zoneIds, zoneLabel)
              }
              title={
                grouped
                  ? badge.layers
                      .map((l) => {
                        const zl = doc.zoneLayers.find((z) => z.layer === l);
                        const n = occupancy.byLayer.get(l)?.count ?? 0;
                        return `${zl ? formatZoneLabels(zl.zoneIds, zoneLabel) : l} — ${n}`;
                      })
                      .join("\n") + "\n(clic para acercar)"
                  : `${formatZoneLabels(badge.zoneIds, zoneLabel)} — ${badge.count} persona(s) · capa ${layer}`
              }
              onSelect={() =>
                grouped
                  ? focusCluster(badge)
                  : onSelectLayer(layer === selectedLayer ? null : layer)
              }
              onHover={(over) => {
                if (grouped) setHoveredCluster(over ? badge.layers : null);
                else setHoveredLayer(over ? layer : null);
              }}
            />
          );
        })}
      </div>

      {mode && (
        <Suspense fallback={null}>
          {mode === "perspective" ? (
            <PerspectiveView
              doc={doc}
              renderer={renderer}
              occupancy={occupancy}
              zoneStyles={zoneStyles}
              startLayer={selectedLayer}
              zoneLabel={zoneLabel}
              onExit={() => setMode(null)}
            />
          ) : (
            <OverheadView
              doc={doc}
              occupancy={occupancy}
              startLayer={selectedLayer}
              zoneLabel={zoneLabel}
              onExit={() => setMode(null)}
            />
          )}
        </Suspense>
      )}

      <PlanControls
        zoom={zoom}
        onZoomIn={() => zoomFromButton(BUTTON_ZOOM_STEP)}
        onZoomOut={() => zoomFromButton(1 / BUTTON_ZOOM_STEP)}
        onFit={resetView}
        onFocusSelection={focusSelection}
        selectionLabel={
          selectedZone ? formatZoneLabels(selectedZone.zoneIds, zoneLabel) : null
        }
      />
    </div>
  );
}

/**
 * Controles de cámara del plano.
 *
 * Un solo bloque con borde en vez de botones sueltos: se lee como un
 * instrumento y no como tres cosas flotando. El indicador de zoom va entre + y
 * −, que es donde uno lo busca.
 *
 * El zoom se muestra relativo al encuadre completo (1× = todo el plano en
 * pantalla), no en porcentaje: un DXF está en unidades de mundo, así que un
 * "100%" no significaría nada.
 */
function PlanControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onFocusSelection,
  selectionLabel,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFocusSelection: () => void;
  selectionLabel: string | null;
}) {
  return (
    <div className="absolute right-3 bottom-3 flex w-8 flex-col overflow-hidden rounded-sm border border-line bg-panel/90 backdrop-blur-[2px]">
      <ViewButton label="Acercar (+)" onClick={onZoomIn}>
        <svg viewBox="0 0 16 16" className="size-3.5" {...STROKE} aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </ViewButton>

      <span
        className="tnum border-y border-line py-1 text-center font-mono text-[9.5px] leading-none text-ink-dim"
        title="Zoom respecto del plano completo"
      >
        {formatZoom(zoom)}
      </span>

      <ViewButton label="Alejar (−)" onClick={onZoomOut}>
        <svg viewBox="0 0 16 16" className="size-3.5" {...STROKE} aria-hidden>
          <path d="M3.5 8h9" />
        </svg>
      </ViewButton>

      <ViewButton label="Ajustar al plano completo (0)" onClick={onFit} divided>
        <svg viewBox="0 0 16 16" className="size-3.5" {...STROKE} aria-hidden>
          <path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10" />
        </svg>
      </ViewButton>

      <ViewButton
        label={
          selectionLabel
            ? `Centrar en ${selectionLabel} (F)`
            : "Centrar en la zona seleccionada (F)"
        }
        onClick={onFocusSelection}
        disabled={selectionLabel === null}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" {...STROKE} aria-hidden>
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
        </svg>
      </ViewButton>
    </div>
  );
}

/** Trazo común de los iconos del panel. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** "0.8×", "1×", "3.4×", "12×" — nunca ruido decimal. */
function formatZoom(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return "—";
  if (zoom >= 10) return `${Math.round(zoom)}×`;
  const rounded = Math.round(zoom * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}×`;
}

function ZoneBadge({
  badge,
  max,
  selected,
  dimmed,
  label,
  title,
  onSelect,
  onHover,
}: {
  badge: BadgeCluster;
  max: number;
  selected: boolean;
  dimmed: boolean;
  label: string;
  title: string;
  onSelect: () => void;
  onHover: (over: boolean) => void;
}) {
  const grouped = badge.layers.length > 1;
  // Un grupo suma varias capas, así que puede superar el máximo por capa.
  const intensity = max > 0 ? Math.min(1, badge.count / max) : 0;
  const empty = badge.count === 0;
  const accent = empty ? DARK_THEME.emptyAccent : rampColor(DARK_THEME.densityRamp, intensity);

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      style={{
        left: badge.x,
        top: badge.y,
        borderColor: selected ? DARK_THEME.zoneStrokeSelected : accent,
        opacity: dimmed ? 0.2 : 1,
        // Un grupo se distingue por el doble borde, como una pila de fichas.
        boxShadow: grouped ? `0 0 0 2px ${DARK_THEME.background}, 0 0 0 3px ${accent}` : undefined,
      }}
      className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-stretch overflow-hidden rounded-sm border bg-abyss/90 backdrop-blur-[2px] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      title={title}
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
        {/* El nombre de la zona, no su id. Truncado: una insignia no puede
            crecer sin taparle el plano a las de al lado. */}
        <span className="mt-1 block max-w-[7rem] truncate text-[9px] leading-none text-ink-dim">
          {label}
        </span>
      </span>
    </button>
  );
}

function ViewButton({
  children,
  label,
  onClick,
  disabled,
  divided,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Separador arriba: agrupa el encuadre aparte del zoom. */
  divided?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-7 place-items-center text-ink-soft transition-colors enabled:hover:bg-hover enabled:hover:text-ink focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-signal disabled:text-ink-dim/40 ${
        divided ? "border-t border-line" : ""
      }`}
    >
      {children}
    </button>
  );
}
