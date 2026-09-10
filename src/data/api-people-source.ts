import {
  DEFAULT_FIELD_MAP,
  mapRowsToPeople,
  type MapRowsOptions,
  type PersonFieldMap,
} from "../core/occupancy/field-map";
import type { PeopleSource } from "../core/occupancy/types";

/**
 * ── LA FUENTE REAL ────────────────────────────────────────────────────────────
 *
 * `PeopleSource` sobre un endpoint HTTP que devuelve las filas de la vista de
 * detección en JSON. El navegador no habla con SQL Server: el endpoint lo pone
 * su backend (ver INTEGRACION.md §1, que trae la SQL de referencia).
 *
 *   const fuente = createApiPeopleSource({
 *     url: "/api/personas",
 *     fieldMap: PEOPLE_FIELD_MAP,   // nombres de columna; ver src/data/source.ts
 *   });
 *
 *   <PeopleProvider source={fuente} sourceId="api" refreshIntervalMs={15_000}>
 *     <PlanOccupancyViewer planUrl="/plano.dxf" />
 *   </PeopleProvider>
 *
 * Lo que acepta como respuesta: un arreglo de filas, o un objeto `{ rows: [] }`
 * / `{ data: [] }`. Cualquier otra forma se resuelve con `rowsFrom`.
 */
export interface ApiPeopleSourceOptions extends MapRowsOptions {
  url: string;
  /** Nombre que se muestra en la cabecera. */
  label?: string;
  /** Qué columna alimenta cada campo. Por defecto, las de la vista de referencia. */
  fieldMap?: PersonFieldMap;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  /** Dónde están las filas dentro del JSON, si no es una de las formas de arriba. */
  rowsFrom?: (json: unknown) => unknown[];
}

/** Arreglo → tal cual; `{ rows }` / `{ data }` → ese arreglo; otra cosa → error claro. */
export function defaultRowsFrom(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json !== null && typeof json === "object") {
    const record = json as Record<string, unknown>;
    for (const key of ["rows", "data", "items", "value"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  throw new Error(
    "La respuesta del API no es un arreglo de filas ni un objeto con `rows`/`data`. " +
      "Pasen `rowsFrom` a createApiPeopleSource para indicar dónde están.",
  );
}

export function createApiPeopleSource(options: ApiPeopleSourceOptions): PeopleSource {
  const {
    url,
    label = "API",
    fieldMap = DEFAULT_FIELD_MAP,
    headers,
    credentials,
    rowsFrom = defaultRowsFrom,
    ...mapOptions
  } = options;

  return {
    label,
    async fetchPeople(signal) {
      const res = await fetch(url, {
        signal,
        credentials,
        headers: { Accept: "application/json", ...headersToRecord(headers) },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} al pedir ${url}`);
      }
      const rows = rowsFrom(await res.json());
      const { people, skipped } = mapRowsToPeople(rows, fieldMap, mapOptions);
      if (skipped > 0) {
        // Se avisa y no se lanza: unas filas malas no deben apagar el plano.
        console.warn(`[people] ${skipped} fila(s) descartadas (sin id, zona o fecha usable)`);
      }
      return people;
    },
  };
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
