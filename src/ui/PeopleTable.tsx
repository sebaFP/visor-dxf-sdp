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

/**
 * Tabla plana, sin librería de data-grid: una dependencia menos que sacar
 * después. Las columnas salen de PERSON_COLUMNS, así que agregar un campo es
 * una línea y no tocar este archivo.
 */
export function PeopleTable({
  people,
  emptyMessage,
  zoneLabel = RAW_ZONE_LABEL,
}: PeopleTableProps) {
  const [query, setQuery] = useState("");
  // Con cientos de filas, filtrar en cada tecla trababa el input.
  const deferredQuery = useDeferredValue(query);
  const now = Date.now();

  const ctx = useMemo<PersonColumnContext>(() => ({ zoneLabel }), [zoneLabel]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      PERSON_COLUMNS.some((col) => col.value(p, ctx).toLowerCase().includes(q)),
    );
  }, [people, deferredQuery, ctx]);

  if (people.length === 0) {
    return <Empty>{emptyMessage}</Empty>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-dim" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar por nombre, RUT o zona"
            className="w-full rounded-sm border border-line bg-abyss py-1.5 pr-2.5 pl-8 text-sm text-ink placeholder:text-ink-dim focus:border-signal focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-collapse text-sm">
          <colgroup>
            <col style={{ width: "2.75rem" }} />
            {PERSON_COLUMNS.map((col) => (
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
            <col style={{ width: "6rem" }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="bg-panel text-[10.5px] font-medium tracking-[0.08em] text-ink-dim uppercase">
              <th className="border-b border-line py-2" />
              {PERSON_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cellClass(col, "border-b border-line py-2 font-medium")}
                >
                  {col.header}
                </th>
              ))}
              <th
                scope="col"
                className="hidden border-b border-line py-2 pr-4 text-right font-medium lg:table-cell"
              >
                Permanencia
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((person) => (
              <tr
                key={person.id}
                className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-hover"
              >
                <td className="py-2 pl-4">
                  <Initials name={person.name} />
                </td>

                {PERSON_COLUMNS.map((col) => (
                  <td key={col.key} className={cellClass(col, "py-2")}>
                    <Cell column={col} person={person} ctx={ctx} />
                  </td>
                ))}

                <td className="hidden py-2 pr-4 text-right lg:table-cell">
                  <span className="tnum font-mono text-[13px] text-ink-soft">
                    {formatElapsed(person.detectedAt, now)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && <Empty>Ningún resultado para “{query}”.</Empty>}
      </div>
    </div>
  );
}

/** Alineación y visibilidad son propiedades de la columna, no del renderizado. */
function cellClass(col: PersonColumn, base: string): string {
  const align = col.variant === "mono" ? "text-right pr-4" : "text-left pr-3";
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

/**
 * Iniciales en vez de avatar: ancla la vista sin inventar una foto que no
 * tenemos y sin pedir un asset más.
 */
function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span className="flex size-7 items-center justify-center rounded-sm border border-line bg-raised text-[11px] font-semibold text-ink-soft">
      {initials}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-12 text-center text-sm text-ink-dim">{children}</p>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" strokeLinecap="round" />
    </svg>
  );
}
