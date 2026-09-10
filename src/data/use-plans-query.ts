import { useQuery } from "@tanstack/react-query";
import type { ProjectEntry } from "../core/dxf/plan-catalog";
import { queryKeys } from "./query-keys";

/**
 * Descarga el catálogo de proyectos/sectores/planos (ver `ProjectEntry`).
 *
 * Con `url` vacía no pide nada y `data` queda `undefined`: el que llama cae a
 * su catálogo estático. Un catálogo no cambia bajo los pies, así que no se
 * revalida solo; F5 lo vuelve a pedir.
 */
export function usePlansQuery(url: string | undefined) {
  return useQuery<ProjectEntry[]>({
    queryKey: queryKeys.plans(url ?? ""),
    queryFn: ({ signal }) => loadProjects(url as string, signal),
    enabled: url !== undefined && url !== "",
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

/** Descarga y valida la forma mínima: arreglo de `{ nombre, dxf, sectores? }`. */
export async function loadProjects(url: string, signal?: AbortSignal): Promise<ProjectEntry[]> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} al pedir ${url}`);
  const json: unknown = await res.json();
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { proyectos?: unknown }).proyectos)
      ? (json as { proyectos: unknown[] }).proyectos
      : null;
  if (!list) {
    throw new Error("El catálogo de planos debe ser un arreglo de proyectos (o `{ proyectos: [...] }`).");
  }
  return list.map((item, index) => {
    const entry = item as Partial<ProjectEntry>;
    if (!entry || typeof entry.nombre !== "string" || typeof entry.dxf !== "string") {
      throw new Error(`Proyecto #${index} del catálogo sin \`nombre\` o \`dxf\`.`);
    }
    for (const sector of entry.sectores ?? []) {
      if (typeof sector?.nombre !== "string" || typeof sector.dxf !== "string") {
        throw new Error(`Un sector de «${entry.nombre}» no trae \`nombre\` o \`dxf\`.`);
      }
    }
    return entry as ProjectEntry;
  });
}
