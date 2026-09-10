import type { Bounds } from "../dxf/types";
import type { Person } from "../occupancy/types";

/**
 * ── INSIGNIAS AGRUPADAS ───────────────────────────────────────────────────────
 *
 * Al alejar el zoom las insignias de conteo se amontonan: el plano de ejemplo
 * son cuatro niveles apilados y de lejos una docena cae sobre los mismos 40 px.
 * Antes ganaba la más poblada y el resto se ocultaba, con lo que sus personas
 * desaparecían de la vista. Ahora se agrupan: una insignia por grupo, con la
 * suma de personas, hasta que el zoom las separa.
 *
 * Greedy y determinista: la candidata con más gente es semilla y absorbe a
 * todas las que caen dentro de una insignia de distancia de ELLA (no del
 * centroide, así dos semillas nunca se tapan entre sí); se repite con las que
 * sobran. La capa seleccionada queda siempre sola: es la que el
 * usuario está mirando y no puede desaparecer dentro de un grupo.
 *
 * Puro y sin React.
 */

/** Una insignia posible, ya proyectada a pantalla. */
export interface BadgeCandidate {
  layer: string;
  zoneIds: readonly string[];
  count: number;
  /** Posición en píxeles de pantalla. */
  x: number;
  y: number;
  /** Qué encuadrar para acercarse a esta capa (mundo). */
  focus: Bounds;
  /** Personas de la capa, para contar sin repetir dentro de un grupo. */
  people: readonly Person[];
}

/**
 * A qué distancia dos insignias se consideran amontonadas. Una insignia es más
 * ancha que alta, así que el criterio es una caja del tamaño de la insignia,
 * no un radio: con un radio menor que el ancho seguían tapándose de lado.
 */
export interface BadgeFootprint {
  /** Ancho de una insignia en píxeles. */
  width: number;
  /** Alto de una insignia en píxeles. */
  height: number;
}

/** Lo que se dibuja: una capa sola o varias sumadas. */
export interface BadgeCluster {
  /** Estable mientras el grupo tenga las mismas capas. */
  key: string;
  layers: string[];
  zoneIds: string[];
  /** Personas distintas en el grupo. Con una sola capa, el conteo de la capa. */
  count: number;
  x: number;
  y: number;
  /** Unión de los encuadres de las capas miembro. */
  focus: Bounds;
}

export function clusterBadges(
  candidates: readonly BadgeCandidate[],
  footprint: BadgeFootprint,
  pinnedLayer: string | null,
): BadgeCluster[] {
  const out: BadgeCluster[] = [];
  const rest: BadgeCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.layer === pinnedLayer) out.push(single(candidate));
    else rest.push(candidate);
  }

  // Más gente primero; a igual conteo, por nombre, para que el resultado no
  // dependa del orden de llegada.
  rest.sort((a, b) => b.count - a.count || (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));

  const used = new Set<string>();
  for (const seed of rest) {
    if (used.has(seed.layer)) continue;
    used.add(seed.layer);
    const members = [seed];
    for (const other of rest) {
      if (used.has(other.layer)) continue;
      if (
        Math.abs(other.x - seed.x) < footprint.width &&
        Math.abs(other.y - seed.y) < footprint.height
      ) {
        used.add(other.layer);
        members.push(other);
      }
    }
    out.push(members.length === 1 ? single(seed) : merge(members));
  }

  return out;
}

function single(c: BadgeCandidate): BadgeCluster {
  return {
    key: c.layer,
    layers: [c.layer],
    zoneIds: [...c.zoneIds],
    count: c.count,
    x: c.x,
    y: c.y,
    focus: c.focus,
  };
}

/** La semilla (la más poblada) va primera y da la posición del grupo. */
function merge(members: readonly BadgeCandidate[]): BadgeCluster {
  const seed = members[0];
  const ids = new Set<string>();
  const zoneIds: string[] = [];
  const layers: string[] = [];
  let focus = { ...seed.focus };

  for (const member of members) {
    layers.push(member.layer);
    for (const zoneId of member.zoneIds) if (!zoneIds.includes(zoneId)) zoneIds.push(zoneId);
    for (const person of member.people) ids.add(person.id);
    focus = {
      minX: Math.min(focus.minX, member.focus.minX),
      minY: Math.min(focus.minY, member.focus.minY),
      maxX: Math.max(focus.maxX, member.focus.maxX),
      maxY: Math.max(focus.maxY, member.focus.maxY),
    };
  }

  return { key: layers.join("+"), layers, zoneIds, count: ids.size, x: seed.x, y: seed.y, focus };
}
