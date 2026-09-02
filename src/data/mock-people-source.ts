import type { Person, PeopleSource } from "../core/occupancy/types";

/**
 * Sample data generator.
 *
 * Exists so the plan is alive before the real detection system is wired up.
 * DELETE THIS FILE once `fetchPeople` talks to your API — nothing else imports
 * it except `src/data/source.ts`.
 *
 * Deterministic by default (seeded PRNG) so screenshots and demos are stable;
 * pass a new seed on each refresh to simulate people moving around.
 */

const FIRST_NAMES = [
  "Camila", "Matías", "Valentina", "Sebastián", "Antonia", "Benjamín", "Josefa",
  "Vicente", "Isidora", "Cristóbal", "Florencia", "Agustín", "Catalina", "Tomás",
  "Fernanda", "Joaquín", "Javiera", "Ignacio", "Constanza", "Diego", "Emilia",
  "Rodrigo", "Paula", "Andrés", "Daniela", "Felipe", "Macarena", "Nicolás",
];

const LAST_NAMES = [
  "González", "Muñoz", "Rojas", "Díaz", "Pérez", "Soto", "Contreras", "Silva",
  "Martínez", "Sepúlveda", "Morales", "Rodríguez", "López", "Fuentes", "Hernández",
  "Torres", "Araya", "Flores", "Espinoza", "Valenzuela", "Castillo", "Tapia",
];

/** Mirrors `gerencia` in the reference schema. */
const AREAS = [
  "Operaciones Mina",
  "Mantenimiento",
  "Planta Concentradora",
  "Seguridad y Salud",
  "Contratistas",
  "Administración",
];

const ROLES = [
  "Operador", "Supervisor", "Mecánico", "Eléctrico", "Prevencionista",
  "Jefe de Turno", "Ayudante", "Ingeniero de Proceso",
];

/** Zones that exist in the detection system but are not drawn on this plan. */
const UNMAPPED_ZONES = ["12", "34", "58", "99", "310", "412"];

/**
 * Pieces of a zone name. The viewer shows `extra.zonaDescripcion` instead of the
 * bare id wherever a zone is named — see `src/core/occupancy/zone-names.ts` —
 * so the sample data carries one to exercise that path.
 */
const ZONE_KINDS = [
  "Galería", "Rampa", "Sala", "Taller", "Estación", "Bodega",
  "Chancado", "Pique", "Refugio", "Comedor", "Acceso", "Subestación",
];

const ZONE_QUALIFIERS = ["Norte", "Sur", "Oriente", "Poniente", "Central", "Principal", "Auxiliar"];

/** Mulberry32 — tiny, fast, good enough for demo data. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

/** Chilean RUT with a valid check digit, so the format looks real to the team. */
function makeRut(rand: () => number): string {
  const body = 5_000_000 + Math.floor(rand() * 20_000_000);
  const digits = String(body).split("").reverse();
  let sum = 0;
  let factor = 2;
  for (const d of digits) {
    sum += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const dv = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  return `${body.toLocaleString("es-CL").replace(/,/g, ".")}-${dv}`;
}

/**
 * Stable name and description for a zone, derived from its id.
 *
 * Derived and not drawn from a fixed list so it survives any plan: the same id
 * always produces the same text, across refreshes and reloads, and the id stays
 * inside it so a zone on screen can still be traced back to the DXF layer.
 */
function zoneNaming(zoneId: string): { ZONA: string; ZONA_DESCRIPCION: string } {
  let hash = 2166136261;
  for (let i = 0; i < zoneId.length; i++) {
    hash = Math.imul(hash ^ zoneId.charCodeAt(i), 16777619);
  }
  const rand = makeRandom(hash);
  const kind = pick(rand, ZONE_KINDS);
  const qualifier = pick(rand, ZONE_QUALIFIERS);
  return {
    ZONA: `${kind} ${zoneId}`,
    ZONA_DESCRIPCION: `${kind} ${qualifier} ${zoneId}`,
  };
}

export interface MockOptions {
  /** Zone IDs actually drawn on the plan — pass `doc.zoneLayers.flatMap(z => z.zoneIds)`. */
  mappedZoneIds: string[];
  /** How many people to generate. */
  total?: number;
  /** Share of people placed in zones NOT drawn on the plan. */
  unmappedRatio?: number;
  seed?: number;
}

export function generatePeople(options: MockOptions): Person[] {
  const { mappedZoneIds, total = 240, unmappedRatio = 0.22, seed = 1 } = options;
  const rand = makeRandom(seed);
  const now = Date.now();
  const people: Person[] = [];

  // Weight zones unevenly — a flat distribution makes the heat map useless.
  const weights = mappedZoneIds.map(() => 0.15 + rand() * rand() * 3);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < total; i++) {
    let zoneId: string;
    if (mappedZoneIds.length === 0 || rand() < unmappedRatio) {
      zoneId = pick(rand, UNMAPPED_ZONES);
    } else {
      let target = rand() * totalWeight;
      let index = 0;
      while (index < weights.length - 1 && target > weights[index]) {
        target -= weights[index];
        index++;
      }
      zoneId = mappedZoneIds[index];
    }

    // Detected somewhere in the last 4 hours.
    const detectedAt = new Date(now - Math.floor(rand() * 4 * 3600 * 1000)).toISOString();

    people.push({
      id: makeRut(rand),
      name: `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)} ${pick(rand, LAST_NAMES)}`,
      zoneId,
      detectedAt,
      extra: {
        area: pick(rand, AREAS),
        cargo: pick(rand, ROLES),
        tag: `TAG-${1000 + Math.floor(rand() * 9000)}`,
        // Nombres del esquema de referencia (ID_ZONA / ZONA / ZONA_DESCRIPCION).
        // El visor los detecta solos y rotula la zona con ellos en vez de
        // mostrar el id crudo; ID_ZONA es `zoneId` y por eso no va acá.
        ...zoneNaming(zoneId),
      },
    });
  }

  return people;
}

/**
 * A PeopleSource backed by the generator, with a small artificial latency so the
 * loading states in the UI are actually exercised.
 */
export function createMockPeopleSource(options: MockOptions): PeopleSource {
  let seed = options.seed ?? 1;
  return {
    label: "Datos de ejemplo",
    async fetchPeople(signal) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      signal?.throwIfAborted();
      // Advance the seed so each refresh reshuffles people between zones.
      return generatePeople({ ...options, seed: seed++ });
    },
  };
}
