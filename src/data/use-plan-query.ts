import { useQuery } from "@tanstack/react-query";
import { loadDxf } from "../core/dxf/parse-dxf";
import type { DxfDocument } from "../core/dxf/types";
import { queryKeys } from "./query-keys";

/**
 * Descarga y parsea el plano una sola vez por URL.
 *
 * `staleTime: Infinity` porque un archivo DXF no cambia bajo los pies: si
 * cambia, cambia su URL. Sin esto, React Query revalidaría al volver a la
 * pestaña y se comería 200 ms de parseo para nada.
 */
export function usePlanQuery(url: string) {
  return useQuery<DxfDocument>({
    queryKey: queryKeys.plan(url),
    queryFn: () => loadDxf(url),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
