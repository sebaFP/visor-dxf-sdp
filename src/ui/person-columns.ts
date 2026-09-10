import {
  readCompany,
  readContract,
  readRole,
  readSpecialty,
} from "../core/occupancy/person-fields";
import type { Person } from "../core/occupancy/types";
import { RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";

/**
 * Columnas de la tabla de personas.
 *
 * Mínimas a propósito: los campos que cualquier sistema de detección ya tiene.
 * Los campos tipados de `Person` (cargo, especialidad, empresa, contrato) se
 * leen con sus lectores; cualquier otra columna del API se conserva en
 * `Person.extra` con el nombre declarado en `PEOPLE_FIELD_MAP.extra` y se lee
 * con `extraField`. Para mostrar una más, agreguen una entrada acá y nada más:
 *
 *   import { extraField } from "../core/occupancy/extra-fields";
 *   { key: "gerencia", header: "Gerencia", value: (p) => extraField(p, "GERENCIA") ?? "—" }
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

/**
 * "10-09-26 09:34" — día y hora de la detección.
 *
 * La hora sola no basta: la gente queda detectada horas después de su último
 * paso, y una lectura de ayer a las 09:34 se lee idéntica a una de hoy. El año
 * va en dos cifras para que la columna quepa junto al resto; para verlo
 * completo, cambien `year` a `"numeric"` acá y nada más.
 */
const DETECTED_FORMAT = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  // es-CL mete una coma entre fecha y hora; un espacio ocupa menos y se lee
  // igual de bien en una celda monoespaciada.
  return DETECTED_FORMAT.format(date).replace(",", "");
}

export function formatElapsed(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Marca de campo ausente. Una celda vacía se lee como un fallo de la tabla. */
const MISSING = "—";

export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name", header: "Nombre", value: (p) => p.name },
  {
    key: "cargo",
    header: "Cargo",
    value: (p) => readRole(p) ?? MISSING,
    secondary: true,
  },
  {
    key: "especialidad",
    header: "Especialidad",
    value: (p) => readSpecialty(p) ?? MISSING,
    secondary: true,
  },
  {
    key: "empresa",
    header: "Empresa",
    value: (p) => readCompany(p) ?? MISSING,
  },
  {
    key: "contrato",
    header: "Contrato",
    value: (p) => readContract(p) ?? MISSING,
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
    // Ancho para "10-09-26 09:34": con 5.5rem la fecha se partía en dos líneas.
    width: "9.5rem",
    secondary: true,
  },
];
