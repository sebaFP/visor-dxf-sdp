import { DEFAULT_FIELD_MAP, mapRowsToPeople } from "../core/occupancy/field-map";
import type { Person, PeopleSource } from "../core/occupancy/types";
import { hash, makeRandom } from "../core/render/placement";
import { PEOPLE_NAME_FALLBACK } from "./source";

/**
 * Datos de ejemplo.
 *
 * Existe para que el plano esté vivo antes de que exista el API real. BORRAR
 * ESTE ARCHIVO cuando `VITE_PEOPLE_API_URL` apunte al endpoint de verdad; solo
 * lo importa `sample-people-provider.tsx`.
 *
 * No fabrica `Person` a mano: genera FILAS con la misma forma que la vista
 * `dbo.SDP_V_TIEMPOREAL_GOM` y las pasa por el mismo `mapRowsToPeople` que usa
 * la fuente real. Así la demo ejercita el adaptador cada 15 s, y este archivo
 * sirve de muestra literal del JSON que el API tiene que devolver. Reproduce a
 * propósito lo que tienen los datos reales:
 *
 *   - es un log: varias lecturas por persona, en zonas y horas distintas; vale
 *     la más reciente (`latestOnly`);
 *   - ~6 % de lecturas sin persona asignada (RUT y NOMBRE nulos): manda TAGID;
 *   - CONTRATO en blanco para el personal propio;
 *   - FECHA sin zona horaria, como la entrega SQL Server.
 *
 * Determinista (PRNG con semilla) para que capturas y demos sean estables; la
 * semilla avanza en cada refresco para que la gente se mueva.
 */

/** Una fila tal como la devuelve la vista de referencia. */
export interface SdpRow {
  FECHA: string;
  NOMBRE: string | null;
  GERENCIA: string;
  RUT: string | null;
  TAGID: string;
  CARGO: string;
  EMPRESA: string;
  CONTRATO: string;
  /** Todavía no existe en la vista real; acá va para que la columna no salga vacía. */
  ESPECIALIDAD: string;
  ID_ZONA: number | string;
  ZONA: string;
  ZONA_DESCRIPCION: string;
  ID_READER: number;
  READER: string;
}

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

/** Códigos de gerencia, como los trae la vista (GMIN, GOM, GOBM…). */
const AREAS = ["GMIN", "GOM", "GOBM", "GMANT", "GPLA", "GSSO", "GADM"];

const ROLES = [
  "OPERADOR MINAS", "SUPERVISOR", "MECANICO", "ELECTRICO", "PREVENCIONISTA",
  "JEFE DE TURNO", "AYUDANTE", "INGENIERO DE PROCESO", "OP JUMBO DTH",
];

const SPECIALTIES = [
  "Mecánica", "Eléctrica", "Instrumentación", "Obras Civiles", "Soldadura",
  "Cañerías", "Estructuras", "Fortificación", "Ventilación", "Sin especialidad",
];

/**
 * Empresa contratista y sus contratos vigentes. Varias tienen más de uno a
 * propósito: es lo que hace visible la cascada de la barra de filtros —
 * elegida la empresa, «Contrato» ofrece solo los suyos.
 *
 * Nombre corto de la contratista y contrato como código de diez dígitos, como
 * en la vista real. El personal propio va con contrato en blanco, igual que
 * ahí. Los nombres son ficticios.
 */
const CONTRACTORS = [
  { empresa: "MONTAJES ANDINOS", contratos: ["4600031102", "4600031877"] },
  { empresa: "SERVICIOS CORDILLERA", contratos: ["4600030418"] },
  { empresa: "INGENIERIA ALTIPLANO", contratos: ["4600029871", "4600030044", "4600031299"] },
  { empresa: "MANTENCION AUSTRAL", contratos: ["4600030339", "4600030612"] },
  { empresa: "CONSTRUCCIONES ELQUI", contratos: ["4600031540"] },
  { empresa: "PERFORACIONES LOA", contratos: ["4600030765", "4600031008"] },
  { empresa: "PERSONAL PROPIO", contratos: [""] },
];

/** Zonas que existen en el sistema de detección pero no están dibujadas. */
const UNMAPPED_ZONES = ["12", "34", "58", "99", "310", "412"];

const ZONE_KINDS = [
  "Galería", "Rampa", "Sala", "Taller", "Estación", "Bodega",
  "Chancado", "Pique", "Refugio", "Comedor", "Acceso", "Subestación",
];

const ZONE_QUALIFIERS = ["Norte", "Sur", "Oriente", "Poniente", "Central", "Principal", "Auxiliar"];

/** Proporción de lecturas cuyo tag no tiene persona asignada, como en la vista. */
const UNASSIGNED_RATIO = 0.06;

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

/** RUT chileno con dígito verificador válido, para que el formato se vea real. */
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

/** "0.451.224.461", como los TAGID reales. */
function makeTag(rand: () => number): string {
  const n = 450_000_000 + Math.floor(rand() * 2_000_000);
  return `0.${String(n).replace(/(\d{3})(?=\d)/g, "$1.")}`;
}

/**
 * Nombre y descripción estables para una zona, derivados de su id: el mismo id
 * siempre produce el mismo texto, y el id queda dentro para poder rastrear la
 * zona en pantalla hasta su capa del DXF.
 */
function zoneNaming(zoneId: string): { ZONA: string; ZONA_DESCRIPCION: string } {
  const rand = makeRandom(hash(zoneId));
  const kind = pick(rand, ZONE_KINDS);
  const qualifier = pick(rand, ZONE_QUALIFIERS);
  return {
    ZONA: `${kind} ${zoneId}`,
    ZONA_DESCRIPCION: `${kind} ${qualifier} ${zoneId}`,
  };
}

/** "2026-09-10T10:13:12.153" en hora local, sin zona horaria: como SQL Server. */
function localDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

export interface MockOptions {
  /** Zone IDs actually drawn on the plan — pass `doc.zoneLayers.flatMap(z => z.zoneIds)`. */
  mappedZoneIds: string[];
  /** Cuántas personas generar. */
  total?: number;
  /** Proporción de personas en zonas que NO están dibujadas en el plano. */
  unmappedRatio?: number;
  seed?: number;
}

/**
 * Filas en la forma de la vista. Cada persona aporta de una a tres lecturas;
 * la más reciente es donde está de verdad y las otras, más viejas, quedan en
 * otras zonas para que la deduplicación tenga trabajo. Se emiten desordenadas
 * a propósito: la más nueva no siempre va primero.
 */
export function generateRows(options: MockOptions): SdpRow[] {
  const { mappedZoneIds, total = 240, unmappedRatio = 0.22, seed = 1 } = options;
  const rand = makeRandom(seed);
  const now = Date.now();
  const rows: SdpRow[] = [];

  // Peso desigual por zona: una distribución plana deja el mapa de calor mudo.
  const weights = mappedZoneIds.map(() => 0.15 + rand() * rand() * 3);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const pickZone = (): string => {
    if (mappedZoneIds.length === 0 || rand() < unmappedRatio) return pick(rand, UNMAPPED_ZONES);
    let target = rand() * totalWeight;
    let index = 0;
    while (index < weights.length - 1 && target > weights[index]) {
      target -= weights[index];
      index++;
    }
    return mappedZoneIds[index];
  };

  for (let i = 0; i < total; i++) {
    const assigned = rand() >= UNASSIGNED_RATIO;
    const contractor = pick(rand, CONTRACTORS);
    const identity = {
      RUT: assigned ? makeRut(rand) : null,
      NOMBRE: assigned
        ? `${pick(rand, LAST_NAMES)} ${pick(rand, LAST_NAMES)} ${pick(rand, FIRST_NAMES)}`.toUpperCase()
        : null,
      TAGID: makeTag(rand),
      GERENCIA: pick(rand, AREAS),
      CARGO: pick(rand, ROLES),
      ESPECIALIDAD: pick(rand, SPECIALTIES),
      EMPRESA: contractor.empresa,
      CONTRATO: pick(rand, contractor.contratos),
    };

    // La lectura vigente: en algún momento de las últimas 4 horas.
    const latestMs = now - Math.floor(rand() * 4 * 3600 * 1000);
    const readings = 1 + Math.floor(rand() * 3);
    const zone = pickZone();

    const reading = (zoneId: string, ms: number): SdpRow => {
      const numeric = Number(zoneId);
      return {
        FECHA: localDateTime(ms),
        ...identity,
        ID_ZONA: Number.isFinite(numeric) ? numeric : zoneId,
        ...zoneNaming(zoneId),
        ID_READER: 1 + Math.floor(rand() * 200),
        READER: `P${600 + Math.floor(rand() * 150)}-SDP-${String(1 + Math.floor(rand() * 20)).padStart(2, "0")}.m`,
      };
    };

    const batch = [reading(zone, latestMs)];
    for (let r = 1; r < readings; r++) {
      // Lecturas anteriores: minutos u horas antes, en otra zona.
      batch.push(reading(pickZone(), latestMs - Math.floor(rand() * 3 * 3600 * 1000) - 60_000));
    }
    if (rand() < 0.5) batch.reverse();
    rows.push(...batch);
  }

  return rows;
}

/** Las filas de arriba, pasadas por el mismo adaptador que usa la fuente real. */
export function generatePeople(options: MockOptions): Person[] {
  return mapRowsToPeople(generateRows(options), DEFAULT_FIELD_MAP, {
    nameFallback: PEOPLE_NAME_FALLBACK,
  }).people;
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
