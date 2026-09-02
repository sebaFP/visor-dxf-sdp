import { useEffect, useRef } from "react";
import type { Person } from "../core/occupancy/types";
import { RAW_ZONE_LABEL, type ZoneLabeller } from "../core/occupancy/zone-names";
import { PeopleTable, type PeopleTableComponent } from "./PeopleTable";

export interface PeopleDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  people: Person[];
  emptyMessage: string;
  /** Color del indicador del encabezado; sale de la rampa de densidad. */
  accent?: string;
  /** Zona legible: descripción → nombre → id. */
  zoneLabel?: ZoneLabeller;
  /** Tabla a usar. Por defecto la del repo; ver `PeopleTableComponent`. */
  table?: PeopleTableComponent;
}

/**
 * Detalle de una zona en un modal.
 *
 * Usa el <dialog> nativo en vez de una librería: el navegador ya da la trampa
 * de foco, cierre con Escape, capa de fondo inerte y semántica de modal. Una
 * dependencia menos que el equipo tenga que sacar, y accesible por defecto.
 *
 * Como el <dialog> modal vive en la top layer, sigue apareciendo por encima del
 * visor cuando este está en pantalla completa. Un modal hecho con divs no.
 */
export function PeopleDialog({
  open,
  onClose,
  title,
  subtitle,
  people,
  emptyMessage,
  accent,
  zoneLabel = RAW_ZONE_LABEL,
  table: Table = PeopleTable,
}: PeopleDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal() sobre un diálogo ya abierto tira; hay que consultar el estado.
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Escape dispara `close` sin pasar por onClose: hay que sincronizar.
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // El backdrop es parte del propio <dialog>, así que un clic en él llega
      // con currentTarget === target. Los clics internos vienen de un hijo.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="people-dialog-title"
      className="w-[min(56rem,calc(100vw-2rem))]"
    >
      <div className="flex h-[min(38rem,calc(100dvh-4rem))] flex-col overflow-hidden rounded-md border border-edge bg-panel shadow-2xl shadow-black/60">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          {accent && (
            <span
              aria-hidden
              className="mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}

          <div className="mr-auto min-w-0">
            <h2
              id="people-dialog-title"
              className="truncate text-[15px] leading-tight font-semibold text-ink"
            >
              {title}
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-dim">{subtitle}</p>
          </div>

          <span className="tnum shrink-0 rounded-sm border border-line bg-raised px-2 py-1 font-mono text-xs text-ink-soft">
            {people.length} {people.length === 1 ? "persona" : "personas"}
          </span>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-sm border border-line p-1.5 text-ink-dim transition-colors hover:border-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <Table people={people} emptyMessage={emptyMessage} zoneLabel={zoneLabel} />
      </div>
    </dialog>
  );
}
