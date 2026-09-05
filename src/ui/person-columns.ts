import { personField } from "../core/occupancy/extra-fields";
import type { Person } from "../core/occupancy/types";
import { RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";

/**
 * Columnas de la tabla de personas.
 *
 * Mínimas a propósito: los campos que cualquier sistema de detección ya tiene.
 * Para mostrar más, pongan el valor en `Person.extra` desde su PeopleSource y
 * agreguen una entrada acá. No hay que tocar nada más.
 *
 *   { key: "gerencia", header: "Gerencia", value: (p) => text(p.extra?.gerencia) }
 */

/**
 * Lo que la tabla sabe y una columna sola no puede deducir. Hoy es solo el
 * rótulo de zona, que depende del catálogo que recibe el visor.
 */
export interface PersonColumnContext {
  /** Zona legible: descripción → nombre → id. */
  zoneLabel: ZoneLabeller;
}

export const DEFAULT_COLUMN_CONTEXT: PersonColumnContext = {
  zoneLabel: RAW_ZONE_LABEL,
};

export interface PersonColumn {
  key: string;
  header: string;
  value: (person: Person, ctx: PersonColumnContext) => string;
  /**
   * Cómo se pinta la celda:
   *   text  — texto normal (por defecto)
   *   mono  — monoespaciado y alineado a la derecha; para códigos, horas
   *   chip  — pastilla; para categorías como la zona
   */
  variant?: "text" | "mono" | "chip";
  /** Ancho de la columna (cualquier valor CSS). Sin esto reparte el sobrante. */
  width?: string;
  /** Se oculta bajo el breakpoint `md`. */
  secondary?: boolean;
}

const TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : TIME_FORMAT.format(date);
}

export function formatElapsed(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Grafías aceptadas para empresa y contrato en `Person.extra`.
 *
 * No es paranoia: el mismo dato viaja con nombre distinto según de dónde salga.
 * En el sistema de referencia, el maestro de personas los llama `empresa` y
 * `nrocontrato`, la sábana de turnos `empresa` y `contrato`, y los endpoints de
 * ubicación emiten además `EMPRESA` y `CONTRATO` en mayúsculas. Se comparan
 * normalizadas (sin mayúsculas, separadores ni acentos), así que `NRO_CONTRATO`
 * y `nroContrato` son la misma clave.
 */
export const COMPANY_KEYS = new Set([
  "empresa",
  "nombreempresa",
  "empresanombre",
  "razonsocial",
  "company",
]);

export const CONTRACT_KEYS = new Set([
  "contrato",
  "nrocontrato",
  "ncontrato",
  "numerocontrato",
  "contratonumero",
  "idcontrato",
  "contract",
  "contractnumber",
]);

/** Marca de campo ausente. Una celda vacía se lee como un fallo de la tabla. */
const MISSING = "—";

export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name", header: "Nombre", value: (p) => p.name },
  {
    key: "empresa",
    header: "Empresa",
    value: (p) => personField(p, COMPANY_KEYS) ?? MISSING,
  },
  {
    key: "contrato",
    header: "Contrato",
    value: (p) => personField(p, CONTRACT_KEYS) ?? MISSING,
    variant: "mono",
    width: "7.5rem",
  },
  // Sin ancho fijo: el rótulo de una zona con nombre no cabe en 5rem.
  { key: "zoneId", header: "Zona", value: (p, ctx) => ctx.zoneLabel(p.zoneId), variant: "chip" },
  {
    key: "detectedAt",
    header: "Detección",
    value: (p) => formatTime(p.detectedAt),
    variant: "mono",
    width: "5.5rem",
    secondary: true,
  },
];
