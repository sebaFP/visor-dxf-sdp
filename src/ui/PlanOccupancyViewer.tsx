import { useMemo, useState } from "react";
import { formatZoneIds } from "../core/dxf/zones";
import { aggregateOccupancy } from "../core/occupancy/aggregate";
import { usePeople } from "../data/people-context";
import { usePlanQuery } from "../data/use-plan-query";
import { DARK_THEME, rampColor } from "../core/render/theme";
import { PeopleDialog } from "./PeopleDialog";
import { PlanCanvas } from "./PlanCanvas";
import { Sidebar, type Selection } from "./Sidebar";

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
}

export function PlanOccupancyViewer({
  planUrl,
  title = "Ocupación por zonas",
  className = "",
}: PlanOccupancyViewerProps) {
  const plan = usePlanQuery(planUrl);
  const { label, people, isFetching, error, updatedAt, refresh } = usePeople();

  const [selection, setSelection] = useState<Selection>(null);
  const [showBaseText, setShowBaseText] = useState(true);

  const doc = plan.data ?? null;
  const occupancy = useMemo(
    () => (doc ? aggregateOccupancy(people, doc.zoneLayers) : null),
    [people, doc],
  );

  const detail = useMemo(() => {
    if (!occupancy || !doc || !selection) return null;

    if (selection.kind === "other") {
      return {
        title: "Otras zonas",
        subtitle:
          occupancy.other.zoneIds.length > 0
            ? `Zonas sin polígono en el plano: ${occupancy.other.zoneIds.join(", ")}`
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

    return {
      title: `Zona ${formatZoneIds(layer.zoneIds)}`,
      subtitle:
        layer.zoneIds.length > 1
          ? `Capa ${layer.layer} — agrupa ${layer.zoneIds.length} zonas`
          : `Capa ${layer.layer}`,
      people: bucket.people,
      empty: "No hay personas detectadas en esta zona.",
      accent: bucket.count === 0 ? "#3d4a58" : rampColor(DARK_THEME.densityRamp, share),
    };
  }, [selection, occupancy, doc]);

  return (
    <div className={`flex h-full min-h-0 flex-col bg-canvas text-ink ${className}`}>
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
            />
          )}
        </section>

        <aside className="flex min-h-0 flex-col border-t border-line bg-panel lg:border-t-0 lg:border-l">
          {doc && occupancy && (
            <Sidebar
              doc={doc}
              occupancy={occupancy}
              selection={selection}
              onSelect={setSelection}
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
      />
    </div>
  );
}

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
