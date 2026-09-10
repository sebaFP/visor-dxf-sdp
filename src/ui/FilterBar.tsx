import { useMemo } from "react";
import {
  projectsOf,
  sectorsOf,
  selectProject,
  selectSector,
  type PlanOption,
  type PlanSelection,
} from "../core/dxf/plan-catalog";
import {
  buildFilterOptions,
  hasActiveFilters,
  setFilter,
  NO_FILTERS,
  PEOPLE_FILTERS,
  type PeopleFilterDef,
  type PeopleFilterState,
} from "../core/occupancy/people-filters";
import type { Person } from "../core/occupancy/types";

export interface FilterBarProps {
  /** Catálogo de planos. Vacío deja proyecto y sector apagados. */
  plans: readonly PlanOption[];
  planSelection: PlanSelection;
  onPlanSelectionChange: (next: PlanSelection) => void;

  /** Todas las personas, sin filtrar: de acá salen empresa y contrato. */
  people: Person[];
  filters: PeopleFilterState;
  onFiltersChange: (next: PeopleFilterState) => void;
  /** Cuántas quedan tras filtrar. Solo para el aviso de la derecha. */
  matched?: number;
  /** Qué desplegables de personas se dibujan. El orden es la cascada. */
  filterDefs?: readonly PeopleFilterDef[];
}

/**
 * La barra de arriba: proyecto, sector, empresa, contrato.
 *
 * Los cuatro se ven iguales y hacen dos cosas distintas, cosa que conviene
 * tener presente al tocar este archivo:
 *
 *   proyecto, sector  →  QUÉ PLANO se carga  (`core/dxf/plan-catalog.ts`)
 *   empresa, contrato →  QUÉ GENTE se cuenta (`core/occupancy/people-filters.ts`)
 *
 * Cada par es su propia cascada: el sector depende del proyecto, el contrato
 * depende de la empresa. Entre pares no hay relación.
 *
 * Son `<select>` nativos, no combos hechos a mano: el navegador ya da teclado,
 * búsqueda por letra, la rueda de iOS y el foco. Lo que se estiliza es la caja,
 * que es lo único que se ve.
 */
export function FilterBar({
  plans,
  planSelection,
  onPlanSelectionChange,
  people,
  filters,
  onFiltersChange,
  matched,
  filterDefs = PEOPLE_FILTERS,
}: FilterBarProps) {
  const projects = useMemo(() => projectsOf(plans), [plans]);
  const sectors = useMemo(
    () => sectorsOf(plans, planSelection.proyecto),
    [plans, planSelection.proyecto],
  );
  const peopleFilters = useMemo(
    () => buildFilterOptions(people, filters, filterDefs),
    [people, filters, filterDefs],
  );

  const active = hasActiveFilters(filters, filterDefs);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-5 border-b border-line bg-canvas px-4 pt-5 pb-4">
      {/* Eligen el DXF. Arrancan sin valor, así que muestran su rótulo adentro
          hasta que alguien elige: es lo que los distingue de los otros dos. */}
      <FilterSelect
        name="proyecto"
        label="Proyecto"
        allLabel={null}
        value={planSelection.proyecto}
        options={projects}
        onPick={(value) => onPlanSelectionChange(selectProject(value))}
      />
      <FilterSelect
        name="sector"
        label="Sector"
        allLabel={null}
        value={planSelection.sector}
        options={sectors}
        onPick={(value) => onPlanSelectionChange(selectSector(planSelection, value))}
      />

      {/* Filtran personas. Siempre muestran algo («Todas», «Todos»). */}
      {peopleFilters.map((filter) => (
        <FilterSelect
          key={filter.key}
          name={filter.key}
          label={filter.label}
          allLabel={filter.allLabel}
          value={filter.value}
          options={filter.options}
          onPick={(value) => onFiltersChange(setFilter(filters, filter.key, value, filterDefs))}
        />
      ))}

      {active && (
        <div className="flex basis-full items-baseline gap-3 sm:basis-auto">
          {matched != null && (
            <span className="text-[11px] text-ink-dim">
              <span className="tnum font-mono text-ink-soft">{matched}</span> de{" "}
              <span className="tnum font-mono text-ink-soft">{people.length}</span>{" "}
              {people.length === 1 ? "persona" : "personas"}
            </span>
          )}
          <button
            type="button"
            onClick={() => onFiltersChange(NO_FILTERS)}
            className="rounded-sm px-1 text-[11px] text-signal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}

interface FilterSelectProps {
  /** Para el id del control. No se muestra. */
  name: string;
  label: string;
  /**
   * Cómo se llama la opción vacía. Con `null` el control arranca sin valor y
   * muestra su rótulo adentro, como marcador de posición; con un texto siempre
   * muestra algo y el rótulo se va flotando arriba del borde. Es la diferencia
   * que se ve entre «Proyecto» y «Empresa».
   */
  allLabel: string | null;
  value: string;
  options: readonly string[];
  onPick: (value: string) => void;
}

function FilterSelect({
  name,
  label,
  allLabel,
  value,
  options,
  onPick,
}: FilterSelectProps) {
  // Sin valores no hay nada que elegir: el control se apaga en vez de abrir un
  // desplegable vacío, que se lee como que el filtro está roto.
  const empty = options.length === 0;
  const floating = allLabel !== null || value !== "";
  const id = `filter-${name}`;

  return (
    <div className="relative min-w-[11rem] flex-1 basis-56">
      {floating && (
        <label
          htmlFor={id}
          className="absolute -top-2 left-2.5 z-10 bg-canvas px-1 text-[11px] leading-none text-ink-dim"
        >
          {label}
        </label>
      )}

      <select
        id={id}
        value={value}
        disabled={empty}
        aria-label={label}
        onChange={(event) => onPick(event.target.value)}
        className={`w-full appearance-none rounded-sm border bg-transparent py-2.5 pr-9 pl-3 text-[13px] transition-colors focus:border-signal focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${
          value !== "" ? "border-edge text-ink" : "border-line text-ink-soft"
        } ${empty ? "" : "hover:border-edge"}`}
      >
        <option value="">{allLabel ?? label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <ChevronIcon />
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-ink-soft"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6.5 4 4 4-4" />
    </svg>
  );
}
