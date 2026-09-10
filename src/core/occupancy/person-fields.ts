import { textValue } from "./extra-fields";
import type { Person } from "./types";

/**
 * Lectores de los campos tipados de `Person`. `null` cuando la fila no trae el
 * campo o viene en blanco — la celda muestra «—» y el desplegable lo omite.
 *
 * Qué columna alimenta cada campo se decide en el field map
 * (`field-map.ts`, y `PEOPLE_FIELD_MAP` en `src/data/source.ts`). Acá no hay
 * nombres de columna a propósito: los leen las columnas de la tabla
 * (`src/ui/person-columns.ts`), los filtros (`people-filters.ts`) y los
 * recorridos, y todos ven lo mismo.
 */
export const readCompany = (person: Person): string | null => textValue(person.company);
export const readContract = (person: Person): string | null => textValue(person.contract);
export const readRole = (person: Person): string | null => textValue(person.role);
export const readSpecialty = (person: Person): string | null => textValue(person.specialty);
