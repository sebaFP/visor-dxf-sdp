import { useDeferredValue, useMemo, useState, type ComponentType } from "react";
import type { Person } from "../core/occupancy/types";
import { RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";
import {
  PERSON_COLUMNS,
  formatElapsed,
  type PersonColumn,
  type PersonColumnContext,
} from "./person-columns";

export interface PeopleTableProps {
  people: Person[];
  emptyMessage: string;
  /**
   * Zona legible: descripción → nombre → id. Sin esto se muestra el id crudo.
   * El visor siempre lo pasa; solo importa si montan la tabla por su cuenta.
   */
  zoneLabel?: ZoneLabeller;
}

/**
 * Contrato de una tabla de personas.
 *
 * Cualquier componente con esta firma sirve como reemplazo — pásenlo por la
 * prop `table` de `<PlanOccupancyViewer>` (o de `<PeopleDialog>`) y el visor
 * usa el suyo en vez de este. Es el punto de salida si necesitan su propio
 * data-grid, exportar a Excel, agrupar, ordenar por columna, etc.
 *
 *   <PlanOccupancyViewer planUrl="/plano.dxf" table={MiTablaDeAgGrid} />
 */
export type PeopleTableComponent = ComponentType<PeopleTableProps>;

/** Filtro por columna: clave de columna → texto tecleado. */
type ColumnFilters = Record<string, string>;

/**
 * Tabla plana, sin librería de data-grid: una dependencia menos que sacar
 * después. Las columnas salen de PERSON_COLUMNS, así que agregar un campo es
 * una línea y no tocar este archivo.
 *
 * El filtro vive bajo cada encabezado, como en el sistema de referencia: se
 * busca dentro de una columna, y varias columnas filtradas se combinan con Y.
 */
export function PeopleTable({
  people,
  emptyMessage,
  zoneLabel = RAW_ZONE_LABEL,
}: PeopleTableProps) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  // Con cientos de filas, filtrar en cada tecla trababa el input.
  const deferredFilters = useDeferredValue(filters);
  const now = Date.now();

  const ctx = useMemo<PersonColumnContext>(() => ({ zoneLabel }), [zoneLabel]);

  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");

  const filtered = useMemo(() => {
    const active = PERSON_COLUMNS.map(
      (col) => [col, (deferredFilters[col.key] ?? "").trim().toLowerCase()] as const,
    ).filter(([, query]) => query !== "");

    if (active.length === 0) return people;
    return people.filter((person) =>
      active.every(([col, query]) => col.value(person, ctx).toLowerCase().includes(query)),
    );
  }, [people, deferredFilters, ctx]);

  if (people.length === 0) {
    return <Empty>{emptyMessage}</Empty>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table className="w-full border-collapse text-sm">
        <colgroup>
          {PERSON_COLUMNS.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
          <col style={{ width: "7rem" }} />
        </colgroup>

        <thead className="sticky top-0 z-10">
          <tr>
            {PERSON_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cellClass(
                  col,
                  "border-b border-line bg-panel px-3 pt-3 pb-2 align-top font-medium first:pl-4",
                )}
              >
                <span className="block text-[12px] leading-snug text-ink-soft">
                  {col.header}
                </span>
                <input
                  type="search"
                  value={filters[col.key] ?? ""}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, [col.key]: event.target.value }))
                  }
                  placeholder="Buscar..."
                  aria-label={`Buscar en ${col.header}`}
                  className="mt-1.5 w-full border-b border-line bg-transparent pb-1 text-[12px] font-normal text-ink placeholder:text-ink-dim focus:border-signal focus:outline-none"
                />
              </th>
            ))}

            <th
              scope="col"
              className="hidden border-b border-line bg-panel px-3 pt-3 pb-2 pr-4 text-right align-top font-medium lg:table-cell"
            >
              <span className="block text-[12px] leading-snug text-ink-soft">
                Permanencia
              </span>
              {/* Calculada al vuelo: no hay texto contra el que buscar. El
                  hueco mantiene la línea base con el resto de encabezados. */}
              <span aria-hidden className="mt-1.5 block h-[1.5rem]" />
            </th>
          </tr>
        </thead>

        <tbody>
          {filtered.map((person) => (
            <tr
              key={person.id}
              className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-hover"
            >
              {PERSON_COLUMNS.map((col) => (
                <td key={col.key} className={cellClass(col, "px-3 py-3 align-top first:pl-4")}>
                  <Cell column={col} person={person} ctx={ctx} />
                </td>
              ))}

              <td className="hidden px-3 py-3 pr-4 text-right align-top lg:table-cell">
                <span className="tnum font-mono text-[13px] text-ink-soft">
                  {formatElapsed(person.detectedAt, now)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <Empty>
          Ningún resultado con los filtros aplicados.{" "}
          <button
            type="button"
            onClick={() => setFilters({})}
            className="text-signal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Limpiar filtros
          </button>
        </Empty>
      )}

      {hasFilters && filtered.length > 0 && (
        <p className="px-4 py-2 text-[11px] text-ink-dim">
          <span className="tnum font-mono">{filtered.length}</span> de{" "}
          <span className="tnum font-mono">{people.length}</span> personas.{" "}
          <button
            type="button"
            onClick={() => setFilters({})}
            className="text-signal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Limpiar filtros
          </button>
        </p>
      )}
    </div>
  );
}

/** Alineación y visibilidad son propiedades de la columna, no del renderizado. */
function cellClass(col: PersonColumn, base: string): string {
  const align = col.variant === "mono" ? "text-right" : "text-left";
  const responsive = col.secondary ? "hidden md:table-cell" : "";
  return `${base} ${align} ${responsive}`;
}

function Cell({
  column,
  person,
  ctx,
}: {
  column: PersonColumn;
  person: Person;
  ctx: PersonColumnContext;
}) {
  const value = column.value(person, ctx);

  if (column.variant === "mono") {
    return <span className="tnum font-mono text-[13px] text-ink-soft">{value}</span>;
  }
  if (column.variant === "chip") {
    return (
      <span className="inline-flex min-w-[2.5rem] justify-center rounded-sm border border-edge bg-raised px-1.5 py-0.5 text-[12px] text-ink-soft">
        {value}
      </span>
    );
  }
  return <span className="text-ink">{value}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-12 text-center text-sm text-ink-dim">{children}</p>;
}
