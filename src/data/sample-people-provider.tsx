import { useMemo, type ReactNode } from "react";
import { createMockPeopleSource } from "./mock-people-source";
import { PeopleProvider } from "./people-context";
import { usePlanQuery } from "./use-plan-query";

/**
 * ── ANDAMIO — BORRAR AL INTEGRAR ─────────────────────────────────────────────
 *
 * Genera personas de ejemplo y las inyecta al visor. Existe solo para que el
 * plano esté vivo antes de que exista la API real.
 *
 * Para conectar el sistema real, reemplacen este componente por el suyo:
 *
 *   <PeopleProvider source={miFuente} sourceId="api" refreshIntervalMs={5000}>
 *     <PlanOccupancyViewer planUrl="/plano.dxf" />
 *   </PeopleProvider>
 *
 * Lee el plano con `usePlanQuery`, la MISMA query que usa el visor, así que
 * comparten caché: los 13 MB se descargan y parsean una sola vez. Lo necesita
 * para saber qué zonas existen y repartir la gente sobre polígonos reales.
 */
export interface SamplePeopleProviderProps {
  /** Debe ser la misma URL que reciba el visor. */
  planUrl: string;
  /** Cuántas personas generar. */
  total?: number;
  /** Proporción que cae en zonas que NO están dibujadas en el plano. */
  unmappedRatio?: number;
  refreshIntervalMs?: number;
  children: ReactNode;
}

export function SamplePeopleProvider({
  planUrl,
  total = 240,
  unmappedRatio = 0.22,
  refreshIntervalMs = 15_000,
  children,
}: SamplePeopleProviderProps) {
  const { data: plan } = usePlanQuery(planUrl);

  const mappedZoneIds = useMemo(
    () => plan?.zoneLayers.flatMap((zl) => zl.zoneIds) ?? [],
    [plan],
  );

  const source = useMemo(
    () => createMockPeopleSource({ mappedZoneIds, total, unmappedRatio }),
    [mappedZoneIds, total, unmappedRatio],
  );

  // La identidad incluye las zonas: mientras el plano no cargó la lista está
  // vacía, y no queremos que esa tanda vacía quede cacheada como la buena.
  const sourceId = `sample:${mappedZoneIds.length}:${total}:${unmappedRatio}`;

  return (
    <PeopleProvider
      source={source}
      sourceId={sourceId}
      refreshIntervalMs={refreshIntervalMs}
    >
      {children}
    </PeopleProvider>
  );
}
