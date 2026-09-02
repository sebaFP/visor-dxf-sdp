import { useMemo, useRef, useState } from "react";
import { formatZoneIds } from "../core/dxf/zones";
import { aggregateOccupancy } from "../core/occupancy/aggregate";
import {
  formatZoneLabels,
  makeZoneLabeller,
  type ZoneCatalog,
} from "../core/occupancy/zone-names";
import { usePeople } from "../data/people-context";
import { usePlanQuery } from "../data/use-plan-query";
import { DARK_THEME, rampColor } from "../core/render/theme";
import { PeopleDialog } from "./PeopleDialog";
import type { PeopleTableComponent } from "./PeopleTable";
import { PlanCanvas } from "./PlanCanvas";
import { Sidebar, type Selection } from "./Sidebar";
import { useFullscreen } from "./use-fullscreen";

/**
 * ── EL COMPONENTE ─────────────────────────────────────────────────────────────
 *
 * Visor de plano con ocupación. Esto es lo que se monta en la aplicación.
 *
 *   <PlanOccupancyViewer planUrl="/plano.dxf" />
 *
 * Necesita un <PeopleProvider> por encima (o <SamplePeopleProvider> para datos
 * de ejemplo) y un <QueryClientProvider> de TanStack Query. No sabe de dónde
 * salen las personas: lee el contexto y ya.
 */
export interface PlanOccupancyViewerProps {
  /** Ruta del DXF. La misma que reciba el proveedor de personas. */
  planUrl: string;
  /** Título de la cabecera. Pasar `null` la oculta y deja solo plano + panel. */
  title?: string | null;
  className?: string;
  /**
   * Cómo se llaman las zonas. El plano solo conoce ids ("85", "81-82"), que no
   * le dicen nada a quien mira la pantalla. Con esto cada id se muestra como su
   * descripción, o su nombre si no hay descripción, o el id si no hay ninguno:
   *
   *   <PlanOccupancyViewer
   *     planUrl="/plano.dxf"
   *     zones={{ "85": { description: "Galería 4 Norte — Nivel 320" } }}
   *   />
   *
   * Si su sistema ya manda la descripción de la zona en `Person.extra`
   * (`zonaDescripcion`, `zoneDescription`, `zonaNombre`…), no hace falta pasar
   * nada: se toma de ahí. Ver `src/core/occupancy/zone-names.ts`.
   */
  zones?: ZoneCatalog;
  /**
   * Tabla de personas del modal. Por defecto la del repo. Cualquier componente
   * con la firma `PeopleTableComponent` sirve — es el punto de salida si
   * necesitan su propio data-grid, exportar, ordenar por columna, etc.
   *
   *   <PlanOccupancyViewer planUrl="/plano.dxf" table={MiTabla} />
   */
  table?: PeopleTableComponent;
  /** Botón de pantalla completa en la cabecera. */
  allowFullscreen?: boolean;
}

export function PlanOccupancyViewer({
  planUrl,
  title = "Ocupación por zonas",
  className = "",
  zones,
  table,
  allowFullscreen = true,
}: PlanOccupancyViewerProps) {
  const plan = usePlanQuery(planUrl);
  const { label, people, isFetching, error, updatedAt, refresh } = usePeople();

  const [selection, setSelection] = useState<Selection>(null);
  const [showBaseText, setShowBaseText] = useState(true);

  // La pantalla completa se pide sobre la raíz del componente, no sobre el
  // documento: así el visor embebido en una página ajena se expande solo él y
  // se lleva su cabecera, su panel y su modal.
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);

  const doc = plan.data ?? null;
  const occupancy = useMemo(
    () => (doc ? aggregateOccupancy(people, doc.zoneLayers) : null),
    [people, doc],
  );

  const zoneLabel = useMemo(() => makeZoneLabeller(zones, people), [zones, people]);

  const detail = useMemo(() => {
    if (!occupancy || !doc || !selection) return null;

    if (selection.kind === "other") {
      return {
        title: "Otras zonas",
        subtitle:
          occupancy.other.zoneIds.length > 0
            ? `Zonas sin polígono en el plano: ${occupancy.other.zoneIds
                .map(zoneLabel)
                .join(", ")}`
            : "Sin personas fuera del plano",
        people: occupancy.other.people,
        empty: "No hay personas en zonas fuera del plano.",
        accent: "#f0a63c",
      };
    }

    const bucket = occupancy.byLayer.get(selection.layer);
    const layer = doc.zoneLayers.find((zl) => zl.layer === selection.layer);
    if (!bucket || !layer) return null;

    const share =
      occupancy.maxLayerCount > 0 ? bucket.count / occupancy.maxLayerCount : 0;

    // El título es el nombre de la zona; el subtítulo guarda la capa y los ids
    // crudos, que es lo que sirve para cruzar con el sistema de detección.
    return {
      title: formatZoneLabels(layer.zoneIds, zoneLabel),
      subtitle:
        layer.zoneIds.length > 1
          ? `Capa ${layer.layer} — agrupa ${layer.zoneIds.length} zonas: ${formatZoneIds(layer.zoneIds)}`
          : `Capa ${layer.layer} — zona ${layer.zoneIds[0]}`,
      people: bucket.people,
      empty: "No hay personas detectadas en esta zona.",
      accent: bucket.count === 0 ? "#3d4a58" : rampColor(DARK_THEME.densityRamp, share),
    };
  }, [selection, occupancy, doc, zoneLabel]);

  return (
    <div
      ref={rootRef}
      className={`flex h-full min-h-0 flex-col bg-canvas text-ink ${className}`}
    >
      {title !== null && (
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
          <div className="mr-auto min-w-0">
            <h1 className="text-[13px] leading-tight font-semibold text-ink">{title}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-dim">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  error ? "bg-red-500" : isFetching ? "bg-signal animate-pulse" : "bg-emerald-500"
                }`}
              />
              {label}
              {updatedAt && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tnum font-mono">
                    {new Date(updatedAt).toLocaleTimeString("es-CL", { hour12: false })}
                  </span>
                </>
              )}
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-soft select-none">
            <input
              type="checkbox"
              checked={showBaseText}
              onChange={(event) => setShowBaseText(event.target.checked)}
              className="accent-signal"
            />
            Textos del plano
          </label>

          <button
            type="button"
            onClick={refresh}
            disabled={isFetching}
            className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-soft transition-colors hover:border-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
          >
            {isFetching ? "Actualizando…" : "Actualizar"}
          </button>

          {allowFullscreen && fullscreen.supported && (
            <button
              type="button"
              onClick={fullscreen.toggle}
              aria-pressed={fullscreen.isFullscreen}
              aria-label={
                fullscreen.isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"
              }
              title={
                fullscreen.isFullscreen
                  ? "Salir de pantalla completa (Esc)"
                  : "Pantalla completa"
              }
              className="rounded-sm border border-line p-1.5 text-ink-soft transition-colors hover:border-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              {fullscreen.isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          )}
        </header>
      )}

      {error && (
        <p role="alert" className="shrink-0 border-b border-line bg-red-950/50 px-4 py-1.5 text-[11px] text-red-300">
          No se pudieron obtener las personas: {error.message}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_19rem]">
        <section className="relative min-h-0">
          {plan.isPending && <Centered>Cargando plano…</Centered>}
          {plan.isError && (
            <Centered tone="error">
              {plan.error instanceof Error ? plan.error.message : "No se pudo cargar el plano."}
            </Centered>
          )}
          {doc && occupancy && (
            <PlanCanvas
              doc={doc}
              occupancy={occupancy}
              selectedLayer={selection?.kind === "layer" ? selection.layer : null}
              onSelectLayer={(layer) => setSelection(layer ? { kind: "layer", layer } : null)}
              showBaseText={showBaseText}
              zoneLabel={zoneLabel}
            />
          )}

          {/* Sin cabecera no hay dónde poner el botón, así que flota sobre el
              plano. Arriba a la derecha: los controles de cámara van abajo. */}
          {title === null && allowFullscreen && fullscreen.supported && (
            <button
              type="button"
              onClick={fullscreen.toggle}
              aria-pressed={fullscreen.isFullscreen}
              aria-label={
                fullscreen.isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"
              }
              title={
                fullscreen.isFullscreen
                  ? "Salir de pantalla completa (Esc)"
                  : "Pantalla completa"
              }
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-sm border border-line bg-panel/90 text-ink-soft backdrop-blur-[2px] transition-colors hover:border-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              {fullscreen.isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          )}
        </section>

        <aside className="flex min-h-0 flex-col border-t border-line bg-panel lg:border-t-0 lg:border-l">
          {doc && occupancy && (
            <Sidebar
              doc={doc}
              occupancy={occupancy}
              selection={selection}
              onSelect={setSelection}
              zoneLabel={zoneLabel}
            />
          )}
        </aside>
      </div>

      <PeopleDialog
        open={detail !== null}
        onClose={() => setSelection(null)}
        title={detail?.title ?? ""}
        subtitle={detail?.subtitle ?? ""}
        people={detail?.people ?? []}
        emptyMessage={detail?.empty ?? ""}
        accent={detail?.accent}
        zoneLabel={zoneLabel}
        table={table}
      />
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" {...ICON_STROKE} aria-hidden>
      <path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" {...ICON_STROKE} aria-hidden>
      <path d="M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5" />
    </svg>
  );
}

const ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={`grid h-full place-items-center px-6 text-center text-sm ${
        tone === "error" ? "text-red-400" : "text-ink-dim"
      }`}
    >
      {children}
    </div>
  );
}
