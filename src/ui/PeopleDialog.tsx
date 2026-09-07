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
  /** Momento de la última respuesta buena de la fuente, en ms. */
  updatedAt?: number | null;
  /** Zona legible: descripción → nombre → id. */
  zoneLabel?: ZoneLabeller;
  /** Tabla a usar. Por defecto la del repo; ver `PeopleTableComponent`. */
  table?: PeopleTableComponent;
}

/** "07-09-2026 10:47:04" — el formato del sistema de referencia. */
const SYNC_FORMAT = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatSync(ms: number): string {
  return SYNC_FORMAT.format(new Date(ms)).replace(",", "");
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
  updatedAt,
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
      className="w-[min(72rem,calc(100vw-2rem))]"
    >
      <div className="flex h-[min(42rem,calc(100dvh-4rem))] flex-col overflow-hidden rounded-md border border-edge bg-panel shadow-2xl shadow-black/60">
        <header className="shrink-0 border-b border-line px-4 pt-3 pb-3">
          <div className="flex items-baseline gap-2">
            {accent && (
              <span
                aria-hidden
                className="size-2.5 shrink-0 translate-y-[-1px] rounded-full"
                style={{ backgroundColor: accent }}
              />
            )}
            <h2
              id="people-dialog-title"
              className="shrink-0 text-[15px] leading-tight font-semibold text-ink"
            >
              {title}
            </h2>
            <p className="min-w-0 truncate text-xs text-ink-dim">{subtitle}</p>
          </div>

          {updatedAt != null && (
            <p className="mt-2 text-[11px] text-ink-dim">
              Última sincronización:{" "}
              <span className="tnum font-mono text-ink-soft">{formatSync(updatedAt)}</span>
            </p>
          )}

          <span className="tnum mt-2 inline-flex items-center rounded-full border border-signal/30 bg-signal/12 px-2.5 py-0.5 text-[11px] font-medium text-signal">
            {people.length} {people.length === 1 ? "Persona" : "Personas"}
          </span>
        </header>

        <Table people={people} emptyMessage={emptyMessage} zoneLabel={zoneLabel} />

        <footer className="flex shrink-0 justify-end border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm bg-red-700 px-6 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </dialog>
  );
}
