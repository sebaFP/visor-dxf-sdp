import { normalizeKey, textValue } from "./extra-fields";
import type { Person } from "./types";

/**
 * ── FILAS DEL API → Person ────────────────────────────────────────────────────
 *
 * El visor no sabe cómo se llaman las columnas del sistema de detección. Se lo
 * dicen con un field map: para cada campo de `Person`, el nombre de la columna
 * que lo trae. Si mañana renombran una columna, se cambia un string acá (o en
 * `PEOPLE_FIELD_MAP`, `src/data/source.ts`) y nada más.
 *
 * Lo que resuelve por su cuenta, porque así vienen los datos reales:
 *
 *  - Las claves se casan sin importar mayúsculas, acentos ni separadores
 *    (`ID_ZONA`, `id_zona` e `idZona` son la misma columna), y se resuelven
 *    una vez por tanda, no por fila.
 *  - `FOR JSON` y los serializadores .NET omiten las columnas nulas, así que
 *    la primera fila puede no traerlas todas: se sigue mirando filas mientras
 *    quede alguna columna sin resolver.
 *  - Identidad de respaldo (`idFallback`): en la vista de referencia el RUT es
 *    nulo cuando el tag no tiene persona asignada; ahí manda el TAGID.
 *  - La vista es un log de lecturas: varias filas por persona. Por defecto se
 *    conserva solo la más reciente (`latestOnly`).
 *  - La fecha se normaliza a ISO UTC (`toISOString`), que es lo que el visor
 *    compara. Acepta `Date`, epoch ms, `"YYYY-MM-DD HH:mm:ss"`, fracciones de
 *    7 dígitos (.NET) y fechas sin zona horaria (ver `assumeOffset`).
 *
 * Puro y sin React.
 */

/** Qué columna de la fila alimenta cada campo de `Person`. Nombres, no valores. */
export interface PersonFieldMap {
  /** Identidad estable. En la vista de referencia: RUT. */
  id: string;
  /** Se usa cuando `id` viene nulo o en blanco. En la referencia: TAGID. */
  idFallback?: string;
  name: string;
  /** Lo que se cruza con las capas del DXF. Un número se convierte a texto. */
  zoneId: string;
  detectedAt: string;
  company?: string;
  contract?: string;
  role?: string;
  specialty?: string;
  zoneName?: string;
  zoneDescription?: string;
  /**
   * Otras columnas que quieran conservar. Van a `Person.extra` con este mismo
   * nombre como clave, aunque el API lo mande en otra grafía: se leen con
   * `extraField(person, "GERENCIA")`.
   */
  extra?: readonly string[];
}

/** Columnas de `dbo.SDP_V_TIEMPOREAL_GOM`, el sistema de referencia. */
export const DEFAULT_FIELD_MAP: PersonFieldMap = {
  id: "RUT",
  idFallback: "TAGID",
  name: "NOMBRE",
  zoneId: "ID_ZONA",
  detectedAt: "FECHA",
  company: "EMPRESA",
  contract: "CONTRATO",
  role: "CARGO",
  // Todavía no existe en la vista: la columna muestra «—» hasta que llegue.
  specialty: "ESPECIALIDAD",
  zoneName: "ZONA",
  zoneDescription: "ZONA_DESCRIPCION",
  extra: ["GERENCIA", "TAGID", "READER"],
};

/** Una fila tal como llega del API. */
export type RawRow = Record<string, unknown>;

export interface MapRowsOptions {
  /**
   * Conservar solo la lectura más reciente por `id`. Por defecto `true`: la
   * fuente de referencia es un log y sin esto una persona se contaría en cada
   * zona por la que pasó.
   */
  latestOnly?: boolean;
  /**
   * Desplazamiento que se agrega cuando la fecha no trae ni `Z` ni `±hh:mm`,
   * p. ej. `"-03:00"`. Sin esto una fecha sin zona horaria se interpreta en la
   * zona horaria del navegador, que es lo correcto mientras navegador y
   * servidor estén en la misma. Ojo con el horario de verano: un valor fijo
   * queda una hora corrido medio año. La solución de verdad es que el API
   * mande la fecha con offset (`FECHA AT TIME ZONE ...` en SQL Server).
   */
  assumeOffset?: string;
  /** Nombre para las filas sin `name`. Por defecto, el propio `id`. */
  nameFallback?: (row: RawRow, id: string) => string;
}

const FIELDS = [
  "id",
  "idFallback",
  "name",
  "zoneId",
  "detectedAt",
  "company",
  "contract",
  "role",
  "specialty",
  "zoneName",
  "zoneDescription",
] as const;

type MappedField = (typeof FIELDS)[number];

/** El field map ya casado con las claves reales de las filas (`null` = no existe). */
export interface ResolvedFieldMap {
  fields: Readonly<Record<MappedField, string | null>>;
  /** `[nombre declarado, clave real | null]` por cada columna de `extra`. */
  extra: ReadonlyArray<readonly [string, string | null]>;
}

/**
 * Casa los nombres del field map con las claves que de verdad traen las filas.
 * Una pasada por tanda; se detiene en cuanto todas las columnas declaradas
 * aparecieron (normalmente en la primera fila).
 */
export function resolveFieldMap(
  map: PersonFieldMap,
  rows: readonly RawRow[],
): ResolvedFieldMap {
  // normalizado → nombres declarados que lo esperan (TAGID puede ser
  // `idFallback` y además una columna de `extra`).
  const wanted = new Map<string, string[]>();
  const declare = (name: string | undefined) => {
    if (!name) return;
    const key = normalizeKey(name);
    const list = wanted.get(key);
    if (list) {
      if (!list.includes(name)) list.push(name);
    } else {
      wanted.set(key, [name]);
    }
  };
  for (const field of FIELDS) declare(map[field]);
  for (const name of map.extra ?? []) declare(name);

  const found = new Map<string, string>();
  let pending = 0;
  for (const names of wanted.values()) pending += names.length;

  for (const row of rows) {
    if (pending === 0) break;
    for (const key of Object.keys(row)) {
      const names = wanted.get(normalizeKey(key));
      if (!names) continue;
      for (const name of names) {
        if (!found.has(name)) {
          found.set(name, key);
          pending--;
        }
      }
    }
  }

  const resolve = (name: string | undefined) => (name ? (found.get(name) ?? null) : null);
  const fields = {} as Record<MappedField, string | null>;
  for (const field of FIELDS) fields[field] = resolve(map[field]);

  return {
    fields,
    extra: (map.extra ?? []).map((name) => [name, resolve(name)] as const),
  };
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Cualquier cosa → ISO UTC (`toISOString`), o `null` si no se puede
 * interpretar. Es lo único que el visor compara, así que todas las fechas
 * tienen que salir de acá con la misma forma.
 */
export function normalizeDetectedAt(value: unknown, assumeOffset?: string): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  }
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (text === "") return null;
  // "2026-09-10 10:13:12" (CONVERT de SQL Server) → forma ISO.
  text = text.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2");
  // .NET escribe 7 decimales ("12.1233333"); la spec admite 3.
  text = text.replace(/(\.\d{3})\d+/, "$1");
  if (assumeOffset && DATE_TIME.test(text) && !HAS_OFFSET.test(text)) {
    text += assumeOffset;
  }

  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Una fila → `Person`, o `null` si no tiene identidad, zona o fecha usable.
 * Una persona sin zona no se puede ubicar y una sin fecha no se puede ordenar
 * ni deduplicar; se descartan y `mapRowsToPeople` las cuenta.
 */
export function mapRowToPerson(
  row: RawRow,
  resolved: ResolvedFieldMap,
  opts: MapRowsOptions = {},
): Person | null {
  const f = resolved.fields;
  const read = (key: string | null) => (key === null ? null : textValue(row[key]));

  const id = read(f.id) ?? read(f.idFallback);
  if (id === null) return null;
  const zoneId = read(f.zoneId);
  if (zoneId === null) return null;
  const detectedAt =
    f.detectedAt === null ? null : normalizeDetectedAt(row[f.detectedAt], opts.assumeOffset);
  if (detectedAt === null) return null;

  const person: Person = {
    id,
    name: read(f.name) ?? opts.nameFallback?.(row, id) ?? id,
    zoneId,
    detectedAt,
    company: read(f.company),
    contract: read(f.contract),
    role: read(f.role),
    specialty: read(f.specialty),
    zoneName: read(f.zoneName),
    zoneDescription: read(f.zoneDescription),
  };

  if (resolved.extra.length > 0) {
    const extra: NonNullable<Person["extra"]> = {};
    for (const [name, key] of resolved.extra) extra[name] = read(key);
    person.extra = extra;
  }

  return person;
}

export interface MapRowsResult {
  people: Person[];
  /** Filas descartadas: no eran objetos, o no traían id, zona o fecha usable. */
  skipped: number;
}

/**
 * Todas las filas de una respuesta → personas listas para el visor.
 *
 *   const { people, skipped } = mapRowsToPeople(await res.json(), PEOPLE_FIELD_MAP);
 */
export function mapRowsToPeople(
  rows: readonly unknown[],
  map: PersonFieldMap = DEFAULT_FIELD_MAP,
  opts: MapRowsOptions = {},
): MapRowsResult {
  const objects: RawRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      objects.push(row as RawRow);
    } else {
      skipped++;
    }
  }

  const resolved = resolveFieldMap(map, objects);
  const latestOnly = opts.latestOnly ?? true;

  if (!latestOnly) {
    const people: Person[] = [];
    for (const row of objects) {
      const person = mapRowToPerson(row, resolved, opts);
      if (person) people.push(person);
      else skipped++;
    }
    return { people, skipped };
  }

  // Última lectura por id. `detectedAt` ya es ISO UTC, así que comparar
  // strings es comparar instantes.
  const byId = new Map<string, Person>();
  for (const row of objects) {
    const person = mapRowToPerson(row, resolved, opts);
    if (!person) {
      skipped++;
      continue;
    }
    const current = byId.get(person.id);
    if (!current || person.detectedAt > current.detectedAt) byId.set(person.id, person);
  }
  return { people: [...byId.values()], skipped };
}
