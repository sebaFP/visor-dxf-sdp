import type { Bounds, DxfDocument, Vec2 } from "../dxf/types";

/**
 * Proyección en perspectiva del plano.
 *
 * El plano es estrictamente 2D: no hay cota en el modelo normalizado. Se
 * reconstruye un volumen extruyendo cada segmento a una altura fija, que es
 * suficiente para recorrer la geometría desde dentro y juzgar distancias — es
 * un apoyo de lectura, no un modelo topográfico.
 *
 * Canvas 2D puro, igual que el resto de `render/`: sin WebGL, sin contexto de
 * GPU que perder y sin dependencias nuevas.
 */

/** Un segmento extruido. Los extremos se guardan planos para no perseguir punteros. */
export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Capa de origen. `null` para la geometría base. */
  layer: string | null;
  /**
   * Detiene a quien lo toque.
   *
   * La geometría base es roca y lo es; el contorno de una zona no. Un polígono
   * de zona es una frontera de datos, no un tabique: si corta el paso y la
   * vista, recorrer el plano es recorrer una jaula.
   */
  solid: boolean;
}

export interface Hit {
  /** Distancia perpendicular al plano de cámara, ya corregida de ojo de pez. */
  distance: number;
  wall: Wall;
  /** Posición del impacto a lo largo del segmento, 0..1. Para el sombreado. */
  along: number;
  /** El segmento se cruzó de canto respecto de X. Da el claroscuro clásico. */
  sideX: boolean;
}

export interface Level {
  walls: Wall[];
  /** Índice espacial disperso: clave de celda → índices en `walls`. */
  grid: Map<number, number[]>;
  cellSize: number;
  bounds: Bounds;
}

/**
 * Segmentos más cortos que esto no se extruyen.
 *
 * La capa base no distingue muro de achurado, mobiliario o línea de cota. Sin
 * este filtro el recorrido es una maraña de tabiques de veinte centímetros y no
 * se reconoce nada. Es la constante a subir si se ve saturado.
 */
const MIN_WALL_LEN = 1.5;
/** Bajo este radio un círculo es simbología, no un pilar. */
const MIN_CIRCLE_RADIUS = 0.5;
const CIRCLE_SIDES = 12;
/** Lado de celda del índice, en unidades de mundo (metros en este plano). */
const CELL_SIZE = 8;
/** Ancho de la grilla en celdas. Fija el empaquetado de la clave. */
const GRID_STRIDE = 1 << 16;

function cellKey(cx: number, cy: number): number {
  return cy * GRID_STRIDE + cx;
}

/**
 * Extrae los muros e indexa.
 *
 * Es el paso caro (decenas de miles de segmentos en un plano grande), así que se
 * hace una sola vez por documento y nunca por frame.
 */
export function buildLevel(doc: DxfDocument): Level {
  const walls: Wall[] = [];

  const push = (a: Vec2, b: Vec2, layer: string | null, solid: boolean): void => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx * dx + dy * dy < MIN_WALL_LEN * MIN_WALL_LEN) return;
    walls.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, layer, solid });
  };

  for (const primitive of doc.base) {
    if (primitive.kind === "path") {
      const pts = primitive.points;
      for (let i = 1; i < pts.length; i++) push(pts[i - 1], pts[i], null, true);
      if (primitive.closed && pts.length > 2) push(pts[pts.length - 1], pts[0], null, true);
    } else if (primitive.kind === "circle" && primitive.radius >= MIN_CIRCLE_RADIUS) {
      // Los círculos no vienen aplanados a propósito (ver dxf/types.ts), así que
      // acá se teselan: un pilar redondo no necesita más de doce lados.
      const { center: c, radius: r } = primitive;
      let prev = { x: c.x + r, y: c.y };
      for (let i = 1; i <= CIRCLE_SIDES; i++) {
        const t = (i / CIRCLE_SIDES) * Math.PI * 2;
        const next = { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r };
        push(prev, next, null, true);
        prev = next;
      }
    }
  }

  // Los anillos de zona entran sin filtro de ruido y sin solidez: se ven, tiñen
  // lo que hay detrás y se cruzan andando.
  for (const zl of doc.zoneLayers) {
    for (const ring of zl.rings) {
      const pts = ring.points;
      for (let i = 1; i < pts.length; i++) push(pts[i - 1], pts[i], zl.layer, false);
      if (pts.length > 2) push(pts[pts.length - 1], pts[0], zl.layer, false);
    }
  }

  const grid = new Map<number, number[]>();
  for (let i = 0; i < walls.length; i++) indexWall(grid, walls[i], i);

  return { walls, grid, cellSize: CELL_SIZE, bounds: doc.bounds };
}

/** Tope de celdas por muro. Un segmento no puede colgar el indexado. */
const MAX_CELLS_PER_WALL = 4096;

/**
 * Mete un muro en las celdas que realmente atraviesa.
 *
 * Por caja envolvente sería una línea de código menos, pero una polilínea
 * diagonal de 500 unidades cae en miles de celdas que no toca, los cubos se
 * hinchan y cada rayo termina probando decenas de miles de segmentos. Recorrer
 * la línea deja el mismo muro en unas decenas de celdas.
 */
function indexWall(grid: Map<number, number[]>, w: Wall, index: number): void {
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;

  let cx = Math.floor(w.ax / CELL_SIZE);
  let cy = Math.floor(w.ay / CELL_SIZE);
  const endX = Math.floor(w.bx / CELL_SIZE);
  const endY = Math.floor(w.by / CELL_SIZE);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // El vector es el segmento completo, así que el parámetro va de 0 a 1.
  const tDeltaX = dx === 0 ? Infinity : Math.abs(CELL_SIZE / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(CELL_SIZE / dy);
  let tMaxX = dx === 0 ? Infinity : (((dx > 0 ? cx + 1 : cx) * CELL_SIZE) - w.ax) / dx;
  let tMaxY = dy === 0 ? Infinity : (((dy > 0 ? cy + 1 : cy) * CELL_SIZE) - w.ay) / dy;

  for (let guard = 0; guard < MAX_CELLS_PER_WALL; guard++) {
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);

    if (cx === endX && cy === endY) return;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxY += tDeltaY;
      cy += stepY;
    }
  }
}

/**
 * Sello de visita: un muro puede estar en varias celdas y no se re-testea dentro
 * del mismo rayo. Un array de enteros con marca creciente evita tener que
 * limpiarlo entre rayos.
 */
let stamps = new Int32Array(0);
let stampTick = 0;

function ensureStamps(size: number): void {
  if (stamps.length < size) {
    stamps = new Int32Array(size);
    stampTick = 0;
  }
}

/**
 * Lanza un rayo y devuelve el muro SÓLIDO más cercano, o `null`.
 *
 * Recorre la grilla celda a celda (DDA) y corta en cuanto el impacto más cercano
 * cae dentro de la celda ya procesada: sin eso habría que testear todo el plano
 * para cada una de las columnas de la pantalla.
 *
 * Los contornos de zona no detienen el rayo. Si se pasa `crossings`, se
 * devuelven ahí los que quedan por delante del impacto sólido, ordenados del
 * más lejano al más cercano — que es el orden en que hay que pintarlos para que
 * se superpongan bien.
 */
export function castRay(
  level: Level,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  crossings?: Hit[],
): Hit | null {
  ensureStamps(level.walls.length);
  const tick = ++stampTick;

  const { cellSize, grid, walls } = level;
  let cx = Math.floor(ox / cellSize);
  let cy = Math.floor(oy / cellSize);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Distancia recorrida al cruzar una celda completa en cada eje.
  const tDeltaX = dx === 0 ? Infinity : Math.abs(cellSize / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(cellSize / dy);

  let tMaxX =
    dx === 0
      ? Infinity
      : (((dx > 0 ? cx + 1 : cx) * cellSize) - ox) / dx;
  let tMaxY =
    dy === 0
      ? Infinity
      : (((dy > 0 ? cy + 1 : cy) * cellSize) - oy) / dy;

  let best: Hit | null = null;
  let travelled = 0;

  while (travelled <= maxDist) {
    const bucket = grid.get(cellKey(cx, cy));
    if (bucket) {
      for (const index of bucket) {
        if (stamps[index] === tick) continue;
        stamps[index] = tick;

        const w = walls[index];
        const ex = w.bx - w.ax;
        const ey = w.by - w.ay;
        const denom = dx * ey - dy * ex;
        if (denom === 0) continue; // Paralelo: nunca se cruza.

        const rx = w.ax - ox;
        const ry = w.ay - oy;
        const t = (rx * ey - ry * ex) / denom; // Distancia sobre el rayo.
        if (t <= 1e-6 || t > maxDist) continue;
        const u = (rx * dy - ry * dx) / denom; // Posición sobre el segmento.
        if (u < 0 || u > 1) continue;

        const hit: Hit = {
          distance: t,
          wall: w,
          along: u,
          sideX: Math.abs(ey) > Math.abs(ex),
        };

        if (!w.solid) {
          if (crossings) crossings.push(hit);
          continue;
        }
        if (!best || t < best.distance) best = hit;
      }
    }

    // El impacto encontrado está dentro de lo ya recorrido: nada más adelante
    // puede ganarle, así que no hace falta seguir caminando la grilla.
    const exit = Math.min(tMaxX, tMaxY);
    if (best && best.distance <= exit) break;

    travelled = exit;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxY += tDeltaY;
      cy += stepY;
    }
  }

  if (crossings && crossings.length > 0) {
    // El recorrido no para en el primer muro sólido que ve, así que puede haber
    // recogido contornos que quedan detrás. Fuera, y el resto de lejos a cerca.
    if (best) {
      const limit = best.distance;
      let write = 0;
      for (let i = 0; i < crossings.length; i++) {
        if (crossings[i].distance <= limit) crossings[write++] = crossings[i];
      }
      crossings.length = write;
    }
    crossings.sort((a, b) => b.distance - a.distance);
  }

  return best;
}

/** Distancia al cuadrado de un punto al segmento, sin raíz. */
function distanceSqToWall(w: Wall, px: number, py: number): number {
  const ex = w.bx - w.ax;
  const ey = w.by - w.ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 === 0 ? 0 : ((px - w.ax) * ex + (py - w.ay) * ey) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = w.ax + ex * t;
  const qy = w.ay + ey * t;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

/**
 * Hay muro SÓLIDO a menos de `radius` del punto.
 *
 * Los contornos de zona quedan fuera a propósito: se cruzan andando.
 */
export function blocked(level: Level, px: number, py: number, radius: number): boolean {
  const { cellSize, grid, walls } = level;
  const minX = Math.floor((px - radius) / cellSize);
  const maxX = Math.floor((px + radius) / cellSize);
  const minY = Math.floor((py - radius) / cellSize);
  const maxY = Math.floor((py + radius) / cellSize);
  const r2 = radius * radius;

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const bucket = grid.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (const index of bucket) {
        const wall = walls[index];
        if (!wall.solid) continue;
        if (distanceSqToWall(wall, px, py) < r2) return true;
      }
    }
  }
  return false;
}

/**
 * Mueve resolviendo cada eje por separado.
 *
 * Es lo que permite deslizarse a lo largo de una pared en vez de quedarse
 * pegado apenas se la roza en diagonal.
 */
export function move(
  level: Level,
  from: Vec2,
  dx: number,
  dy: number,
  radius: number,
): Vec2 {
  let { x, y } = from;
  if (!blocked(level, x + dx, y, radius)) x += dx;
  if (!blocked(level, x, y + dy, radius)) y += dy;
  return { x, y };
}

/**
 * Punto despejado más cercano a `from`, buscando en anillos concéntricos.
 *
 * El punto de partida natural es el centroide de una zona, y un centroide cae
 * dentro de la geometría con toda naturalidad: el polígono puede ser cóncavo y
 * el plano tiene tabiques por dentro. Arrancar empotrado en un muro deja la
 * pantalla tapada y sin salida evidente.
 */
export function findOpenSpot(
  level: Level,
  from: Vec2,
  radius: number,
  maxRadius = 60,
): Vec2 {
  if (!blocked(level, from.x, from.y, radius)) return from;

  const step = Math.max(0.5, radius);
  for (let r = step; r <= maxRadius; r += step) {
    const samples = Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      const x = from.x + Math.cos(angle) * r;
      const y = from.y + Math.sin(angle) * r;
      if (!blocked(level, x, y, radius)) return { x, y };
    }
  }
  return from;
}

/**
 * Sitio despejado a `distance` de `target`, y a ser posible con vista a él.
 *
 * Nacer en el centro de lo que se quiere mirar no sirve: se aparece dentro del
 * grupo, cada silueta tapa la pantalla y no se entiende dónde se está. A una
 * distancia y de frente, la escena se lee de una.
 */
export function findVantagePoint(
  level: Level,
  target: Vec2,
  distance: number,
  radius: number,
  samples = 32,
  /** Condición extra del sitio. Sirve para no aparecer encima de alguien. */
  isClear?: (at: Vec2) => boolean,
): Vec2 {
  let fallback: Vec2 | null = null;
  let crowded: Vec2 | null = null;

  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const at = {
      x: target.x + Math.cos(angle) * distance,
      y: target.y + Math.sin(angle) * distance,
    };
    if (blocked(level, at.x, at.y, radius)) continue;
    if (!crowded) crowded = at;
    if (isClear && !isClear(at)) continue;
    if (!fallback) fallback = at;

    // El vector es el trayecto completo, así que un impacto con t <= 1 es un
    // muro entre medio: sin línea de visión, este sitio no sirve.
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (!castRay(level, at.x, at.y, dx, dy, 1)) return at;
  }

  return fallback ?? crowded ?? findOpenSpot(level, target, radius);
}

/**
 * Hay vista despejada entre dos puntos.
 *
 * El vector se pasa entero y se acota el parámetro a 1, así que cualquier
 * impacto está entre medio: no hace falta normalizar ni medir la distancia.
 */
export function hasLineOfSight(level: Level, from: Vec2, to: Vec2): boolean {
  return castRay(level, from.x, from.y, to.x - from.x, to.y - from.y, 1) === null;
}
