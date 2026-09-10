import { personField } from "./extra-fields";
import type { Person } from "./types";

/**
 * Grafías aceptadas para los campos de persona que el visor usa por nombre.
 *
 * No es paranoia: el mismo dato viaja con nombre distinto según de dónde salga.
 * En el sistema de referencia, el maestro de personas los llama `empresa` y
 * `nrocontrato`, la sábana de turnos `empresa` y `contrato`, y los endpoints de
 * ubicación emiten además `EMPRESA` y `CONTRATO` en mayúsculas. Se comparan
 * normalizadas (sin mayúsculas, separadores ni acentos), así que `NRO_CONTRATO`
 * y `nroContrato` son la misma clave.
 *
 * Vive en `core` y no junto a la tabla porque lo leen dos cosas: las columnas
 * (`src/ui/person-columns.ts`) y los filtros (`people-filters.ts`). Un campo
 * declarado dos veces se desincroniza a la primera grafía nueva.
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

export const ROLE_KEYS = new Set([
  "cargo",
  "nombrecargo",
  "cargonombre",
  "descripcioncargo",
  "cargodescripcion",
  "puesto",
  "role",
  "position",
]);

export const SPECIALTY_KEYS = new Set([
  "especialidad",
  "nombreespecialidad",
  "especialidadnombre",
  "descripcionespecialidad",
  "especialidaddescripcion",
  "disciplina",
  "specialty",
  "speciality",
]);

/** Atajos legibles. `null` cuando la persona no trae el campo. */
export const readCompany = (person: Person) => personField(person, COMPANY_KEYS);
export const readContract = (person: Person) => personField(person, CONTRACT_KEYS);
export const readRole = (person: Person) => personField(person, ROLE_KEYS);
export const readSpecialty = (person: Person) => personField(person, SPECIALTY_KEYS);
