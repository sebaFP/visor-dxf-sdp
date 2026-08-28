import type { Person } from "../core/occupancy/types";

/**
 * Columnas de la tabla de personas.
 *
 * Mínimas a propósito: los campos que cualquier sistema de detección ya tiene.
 * Para mostrar más, pongan el valor en `Person.extra` desde su PeopleSource y
 * agreguen una entrada acá. No hay que tocar nada más.
 *
 *   { key: "gerencia", header: "Gerencia", value: (p) => String(p.extra?.gerencia ?? "—") }
 */
export interface PersonColumn {
  key: string;
  header: string;
  value: (person: Person) => string;
  /**
   * Cómo se pinta la celda:
   *   text  — texto normal (por defecto)
   *   mono  — monoespaciado y alineado a la derecha; para RUT, horas, códigos
   *   chip  — pastilla; para categorías cortas como la zona
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

export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "name", header: "Nombre", value: (p) => p.name },
  { key: "id", header: "RUT", value: (p) => p.id, variant: "mono", width: "8.5rem" },
  { key: "zoneId", header: "Zona", value: (p) => p.zoneId, variant: "chip", width: "5rem" },
  {
    key: "detectedAt",
    header: "Detección",
    value: (p) => formatTime(p.detectedAt),
    variant: "mono",
    width: "5.5rem",
    secondary: true,
  },
];
