import type { DxfDocument } from "../core/dxf/types";
import { formatZoneIds } from "../core/dxf/zones";
import { compareZoneIds } from "../core/occupancy/aggregate";
import type { OccupancySnapshot } from "../core/occupancy/types";
import { DARK_THEME, rampColor } from "../core/render/theme";

/** Qué está mostrando el modal. */
export type Selection = { kind: "layer"; layer: string } | { kind: "other" } | null;

export interface SidebarProps {
  doc: DxfDocument;
  occupancy: OccupancySnapshot;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function Sidebar({ doc, occupancy, selection, onSelect }: SidebarProps) {
  const layers = [...doc.zoneLayers].sort((a, b) => {
    const ca = occupancy.byLayer.get(a.layer)?.count ?? 0;
    const cb = occupancy.byLayer.get(b.layer)?.count ?? 0;
    return cb - ca || compareZoneIds(a.layer, b.layer);
  });

  const offPlanShare =
    occupancy.total > 0 ? Math.round((occupancy.other.count / occupancy.total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
      <div className="grid shrink-0 grid-cols-2 border-b border-line">
        <Stat label="Total detectadas" value={occupancy.total} />
        <Stat label="En el plano" value={occupancy.mappedCount} divided />
      </div>

      {/* Personas que el plano no puede ubicar. Nunca se descartan en silencio. */}
      <button
        type="button"
        onClick={() => onSelect(selection?.kind === "other" ? null : { kind: "other" })}
        className={`shrink-0 border-b border-line px-4 py-3 text-left transition-colors focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-signal ${
          selection?.kind === "other" ? "bg-alert/10" : "hover:bg-hover"
        }`}
      >
        <div className="flex items-baseline gap-2">
          <span className="mr-auto text-[13px] font-medium text-ink">Otras zonas</span>
          {offPlanShare > 0 && (
            <span className="tnum mr-1 font-mono text-[11px] text-ink-dim">
              {offPlanShare}%
            </span>
          )}
          <span className="tnum font-mono text-lg leading-none font-semibold text-alert">
            {occupancy.other.count}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-ink-dim">
          {occupancy.other.zoneIds.length === 0
            ? "Todas las personas están en zonas del plano"
            : `Sin polígono · ${occupancy.other.zoneIds.join(", ")}`}
        </p>
      </button>

      <h2 className="shrink-0 px-4 pt-4 pb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-dim uppercase">
        Zonas del plano · {layers.length}
      </h2>

      <div className="flex flex-col pb-3">
        {layers.map((zl) => {
          const count = occupancy.byLayer.get(zl.layer)?.count ?? 0;
          const active = selection?.kind === "layer" && selection.layer === zl.layer;
          const share = occupancy.maxLayerCount > 0 ? count / occupancy.maxLayerCount : 0;
          const accent = count === 0 ? "#3d4a58" : rampColor(DARK_THEME.densityRamp, share);

          return (
            <button
              key={zl.layer}
              type="button"
              onClick={() => onSelect(active ? null : { kind: "layer", layer: zl.layer })}
              aria-pressed={active}
              className={`relative flex items-center gap-3 px-4 py-2 text-left transition-colors focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-signal ${
                active ? "bg-raised" : "hover:bg-hover"
              }`}
            >
              {/* Barra de densidad al pie de la fila. Como regla fina y no como
                  bloque de fondo: se lee la distribución de un vistazo sin
                  ensuciar el texto ni cortar la fila por la mitad. */}
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-[2px] transition-[width] duration-300"
                style={{ width: `${share * 100}%`, backgroundColor: accent }}
              />
              {active && (
                <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-signal" />
              )}

              <span
                aria-hidden
                className="relative size-2 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />

              <span className="relative min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">
                  {formatZoneIds(zl.zoneIds)}
                </span>
                {zl.zoneIds.length > 1 && (
                  <span className="block truncate text-[10.5px] text-ink-dim">
                    capa {zl.layer} · {zl.zoneIds.length} zonas agrupadas
                  </span>
                )}
              </span>

              <span
                className={`tnum relative shrink-0 font-mono text-[13px] ${
                  count === 0 ? "text-ink-dim" : "text-ink"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  divided,
}: {
  label: string;
  value: number;
  divided?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${divided ? "border-l border-line" : ""}`}>
      <div className="tnum font-mono text-2xl leading-none font-semibold text-ink">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-ink-dim">{label}</div>
    </div>
  );
}
