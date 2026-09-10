import { readCompany, readContract } from "./person-fields";
import type { Person } from "./types";

/**
 * ── FILTROS DE PERSONAS ───────────────────────────────────────────────────────
 *
 * Empresa y contrato. Filtran el conjunto de personas *antes* de agregarlo por
 * zona, así que el plano, los conteos del panel y la tabla del modal miran
 * todos lo mismo.
 *
 * Son en cascada, en el orden declarado: las opciones de un filtro salen de las
 * personas que ya pasaron los anteriores. Con nada puesto, «Empresa» lista las
 * empresas de todos los datos; elegida una, «Contrato» lista solo los contratos
 * de esa empresa. Sin la cascada el segundo desplegable ofrecería contratos que
 * no dan ninguna fila.
 *
 * Los otros dos desplegables de la barra —proyecto y sector— no filtran gente:
 * eligen qué DXF se carga. Viven en `src/core/dxf/plan-catalog.ts`.
 *
 * Puro y sin React.
 */

export type PeopleFilterKey = "empresa" | "contrato";

export interface PeopleFilterDef {
  key: PeopleFilterKey;
  /** Rótulo del control. */
  label: string;
  /** Cómo se llama «sin filtrar» en este desplegable: «Todas», «Todos». */
  allLabel: string;
  /** Valor del campo en una persona, o `null` si no lo trae. */
  read: (person: Person) => string | null;
}

/** El orden importa: es el orden de la cascada. */
export const PEOPLE_FILTERS: readonly PeopleFilterDef[] = [
  { key: "empresa", label: "Empresa", allLabel: "Todas", read: readCompany },
  { key: "contrato", label: "Contrato", allLabel: "Todos", read: readContract },
];

/** Qué está elegido. Ausente o `""` significa «sin filtrar por este campo». */
export type PeopleFilterState = Partial<Record<PeopleFilterKey, string>>;

export const NO_FILTERS: PeopleFilterState = {};

/** Lo que la barra necesita para dibujar un desplegable. */
export interface PeopleFilterOption extends PeopleFilterDef {
  /** Valor elegido, `""` si ninguno. */
  value: string;
  /** Valores posibles dado lo que ya filtraron los anteriores. */
  options: string[];
}

export function hasActiveFilters(state: PeopleFilterState): boolean {
  return PEOPLE_FILTERS.some((def) => (state[def.key] ?? "") !== "");
}

/** ¿Esta persona pasa todos los filtros puestos? */
export function matchesFilters(person: Person, state: PeopleFilterState): boolean {
  return PEOPLE_FILTERS.every((def) => {
    const wanted = state[def.key] ?? "";
    return wanted === "" || def.read(person) === wanted;
  });
}

/** El subconjunto visible. Devuelve el mismo arreglo si no hay nada puesto. */
export function filterPeople(
  people: readonly Person[],
  state: PeopleFilterState,
): Person[] {
  if (!hasActiveFilters(state)) return people as Person[];
  return people.filter((person) => matchesFilters(person, state));
}

/**
 * Elegir un valor en un filtro invalida los de abajo: cambiar de empresa deja
 * el contrato anterior sin sentido, y dejarlo puesto daría cero filas sin que
 * se vea por qué. Se limpian los posteriores y se conservan los anteriores.
 */
export function setFilter(
  state: PeopleFilterState,
  key: PeopleFilterKey,
  value: string,
): PeopleFilterState {
  const index = PEOPLE_FILTERS.findIndex((def) => def.key === key);
  const next: PeopleFilterState = {};
  for (let i = 0; i < PEOPLE_FILTERS.length; i++) {
    const def = PEOPLE_FILTERS[i];
    if (i < index) {
      const kept = state[def.key] ?? "";
      if (kept !== "") next[def.key] = kept;
    } else if (i === index && value !== "") {
      next[def.key] = value;
    }
  }
  return next;
}

/** Numérico cuando ambos lo son, para que «4600029871» ordene como número. */
function compareValues(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

/**
 * Opciones de los desplegables en una pasada, respetando la cascada.
 *
 * Un valor elegido que ya no existe en los datos (la fuente refrescó y esa
 * empresa no tiene a nadie) igual se ofrece: si desapareciera de la lista, el
 * control se vería «sin filtrar» mientras el filtro sigue puesto.
 */
export function buildFilterOptions(
  people: readonly Person[],
  state: PeopleFilterState,
): PeopleFilterOption[] {
  let scope: readonly Person[] = people;
  const out: PeopleFilterOption[] = [];

  for (const def of PEOPLE_FILTERS) {
    const values = new Set<string>();
    for (const person of scope) {
      const value = def.read(person);
      if (value !== null) values.add(value);
    }

    const value = state[def.key] ?? "";
    if (value !== "") values.add(value);

    out.push({ ...def, value, options: [...values].sort(compareValues) });

    if (value !== "") scope = scope.filter((person) => def.read(person) === value);
  }

  return out;
}
