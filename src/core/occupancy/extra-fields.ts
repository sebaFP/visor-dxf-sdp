import type { Person } from "./types";

/**
 * Utilidades de lectura de valores sueltos.
 *
 * `normalizeKey` la usa `field-map.ts` para casar los nombres de columna del
 * field map con las claves reales que manda el API, sin importar mayúsculas,
 * acentos ni separadores. `textValue` y `extraField` leen valores ya mapeados.
 */

/**
 * Reduce una clave a su forma comparable: sin mayúsculas, sin separadores y sin
 * acentos. `ZONA_DESCRIPCION`, `zonaDescripcion` y `"Zona Descripción"` son la
 * misma cosa.
 */
export function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Valor como texto no vacío, o null. Los números cuentan; el blanco no. */
export function textValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Lee `Person.extra[key]` por el nombre declarado en el field map
 * (`extraField(p, "GERENCIA")`). `null` si no está o viene en blanco.
 */
export function extraField(person: Person, key: string): string | null {
  return person.extra ? textValue(person.extra[key]) : null;
}
