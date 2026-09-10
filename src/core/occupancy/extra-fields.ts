import type { Person } from "./types";

/**
 * Lectura tolerante de `Person.extra`.
 *
 * Cada sistema escribe el mismo campo a su manera —EMPRESA, empresa, nrocontrato,
 * NRO_CONTRATO— y ninguna de esas variantes merece un reporte de error. Acá se
 * comparan las claves normalizadas, así que todas caen en la misma.
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

/** Primer valor no vacío de `extra` cuya clave normalizada esté en `keys`. */
export function firstOf(
  extra: NonNullable<Person["extra"]>,
  keys: ReadonlySet<string>,
): string | null {
  for (const key of Object.keys(extra)) {
    if (!keys.has(normalizeKey(key))) continue;
    const value = textValue(extra[key]);
    if (value !== null) return value;
  }
  return null;
}

/** Lee un campo de una persona probando varias grafías. */
export function personField(
  person: Person,
  keys: ReadonlySet<string>,
): string | null {
  return person.extra ? firstOf(person.extra, keys) : null;
}
