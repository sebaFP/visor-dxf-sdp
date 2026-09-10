import { pointInPolygon } from "../dxf/geometry";
import type { DxfDocument, Vec2 } from "../dxf/types";
import type { OccupancySnapshot, Person } from "../occupancy/types";
import { blocked, findOpenSpot, type Level } from "./perspective";

/**
 * Dónde poner a cada persona detectada sobre el plano.
 *
 * El sistema de detección da zona, no coordenadas. La posición, por tanto, se
 * inventa — pero derivada del id de la persona, para que la misma persona caiga
 * siempre en el mismo sitio y no salte entre frames ni entre refrescos.
 *
 * Vive aparte del recorrido porque no es una decisión de proyección: es la
 * traducción de "hay doce en la zona 85" a doce puntos del plano, y sirve igual
 * mirando de frente que mirando desde arriba.
 */

/** Hash estable de una cadena. Misma persona, misma posición, siempre. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32. Determinista y de una línea: no hace falta más. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Radio del grupo alrededor del centro de un anillo.
 *
 * Repartir uniformemente por el polígono sería igual de inventado y peor: una
 * capa como "75-142-128-207" cubre cuatro zonas repartidas por medio plano, y
 * la gente queda a cientos de unidades unos de otros — recorriéndola no se
 * cruza a nadie. Alrededor del centro de su anillo se leen como lo que son:
 * gente trabajando en un sitio, repartida por él y no amontonada en un corro.
 */
const CLUSTER_RADIUS = 34;
/**
 * Fracción del radio que usa el primer intento de colocación.
 *
 * Casi todos aciertan a la primera, así que este número es el que manda de
 * verdad: con 0,2 la zona entera cabía en cuatro metros y el grupo salía
 * apelotonado delante de las narices.
 */
const CLUSTER_SPREAD = 0.62;

/** Una persona detectada, ya con un punto del plano asignado. */
export interface Placement {
  person: Person;
  /** Capa DXF de la zona en la que el sistema la sitúa. */
  layer: string;
  /**
   * Índice del anillo dentro de la capa.
   *
   * Una capa puede tener varios anillos repartidos por el plano ("75-142-128-207"
   * cubre cuatro salas en distintos niveles), y para casi todo lo que se hace con
   * la gente colocada importa en cuál de ellos está, no solo en qué capa.
   */
  ringIndex: number;
  at: Vec2;
  /** Semilla ya consumida para esta persona. Sirve para variar fases y matices. */
  seed: number;
}

export interface PlacementOptions {
  /**
   * Nivel con el que desencallar a quien nazca dentro de un muro.
   *
   * Es opcional porque construirlo cuesta decenas de miles de segmentos, y solo
   * lo necesita quien además vaya a chocar con ellos.
   */
  level?: Level;
  /** Radio del cuerpo, para el desencallado. */
  radius?: number;
  /** Hasta dónde buscar hueco al desencallar. */
  unstickRadius?: number;
}

export function placePeople(
  doc: DxfDocument,
  occupancy: OccupancySnapshot,
  options: PlacementOptions = {},
): Placement[] {
  const { level, radius = 0.4, unstickRadius = 8 } = options;
  const placements: Placement[] = [];

  for (const zl of doc.zoneLayers) {
    const bucket = occupancy.byLayer.get(zl.layer);
    if (!bucket || bucket.count === 0) continue;

    const rings = zl.rings.filter((r) => Math.abs(r.area) > 0);
    if (rings.length === 0) continue;

    // Los anillos grandes se llevan más gente que los pequeños.
    const weights = rings.map((r) => Math.abs(r.area));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    for (const person of bucket.people) {
      const seed = hash(person.id);
      const rand = makeRandom(seed);

      let target = rand() * totalWeight;
      let index = 0;
      while (index < weights.length - 1 && target > weights[index]) {
        target -= weights[index];
        index++;
      }
      const ring = rings[index];
      const ringIndex = zl.rings.indexOf(ring);

      const { minX, maxX, minY, maxY } = ring.bounds;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const spread = Math.min(CLUSTER_RADIUS, Math.max(maxX - minX, maxY - minY) / 3);

      let placed: Vec2 | null = null;
      for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        // El radio crece con los intentos: si el centro del anillo cae fuera del
        // polígono (los cóncavos lo hacen), se busca más lejos en vez de rendirse.
        // La raíz reparte por área y no por radio, que amontona hacia el centro.
        const reach = spread * (CLUSTER_SPREAD + (attempt / 24) * 0.9) * Math.sqrt(rand());
        const angle = rand() * Math.PI * 2;
        const candidate = { x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach };
        if (pointInPolygon(candidate, ring.points)) placed = candidate;
      }

      // Estar dentro del polígono de la zona no basta: el plano tiene tabiques
      // por dentro y quien nazca empotrado en uno no puede dar un paso, así que
      // se queda de adorno mirando a la pared.
      let at = placed ?? { x: cx, y: cy };
      if (level && blocked(level, at.x, at.y, radius)) {
        at = findOpenSpot(level, at, radius, unstickRadius);
      }

      placements.push({ person, layer: zl.layer, ringIndex, at, seed });
    }
  }

  return placements;
}
