import { createContext, useContext, useMemo, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PeopleSource, Person } from "../core/occupancy/types";
import { queryKeys } from "./query-keys";

/**
 * Lo que el visor consume. No sabe de dónde salen las personas ni cómo se
 * refrescan: solo lee este contexto.
 */
export interface PeopleContextValue {
  /** Nombre de la fuente, para mostrar en la cabecera. */
  label: string;
  people: Person[];
  /** Primera carga, sin datos previos que mostrar. */
  isLoading: boolean;
  /** Hay una petición en vuelo (incluye refrescos en segundo plano). */
  isFetching: boolean;
  error: Error | null;
  /** Momento de la última respuesta correcta. */
  updatedAt: number | null;
  refresh: () => void;
}

const PeopleContext = createContext<PeopleContextValue | null>(null);

export function usePeople(): PeopleContextValue {
  const value = useContext(PeopleContext);
  if (!value) {
    throw new Error(
      "usePeople() necesita un <PeopleProvider> por encima. " +
        "Envuelvan el visor con su proveedor (o con <SamplePeopleProvider> para datos de ejemplo).",
    );
  }
  return value;
}

export interface PeopleProviderProps {
  /** Implementación de dónde salen las personas. */
  source: PeopleSource;
  /**
   * Identidad de la fuente para la caché. Dos proveedores con el mismo id
   * comparten datos; cambiarlo fuerza una recarga limpia.
   */
  sourceId: string;
  /** Milisegundos entre refrescos automáticos. 0 los desactiva. */
  refreshIntervalMs?: number;
  children: ReactNode;
}

/**
 * Proveedor genérico: toma un `PeopleSource` y lo expone vía React Query.
 *
 * `keepPreviousData` es deliberado — durante un refresco el plano sigue
 * mostrando los últimos conteos buenos en vez de parpadear a cero.
 */
export function PeopleProvider({
  source,
  sourceId,
  refreshIntervalMs = 15_000,
  children,
}: PeopleProviderProps) {
  const query = useQuery<Person[]>({
    queryKey: queryKeys.people(sourceId),
    queryFn: ({ signal }) => source.fetchPeople(signal),
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    staleTime: refreshIntervalMs > 0 ? refreshIntervalMs / 2 : 0,
  });

  const value = useMemo<PeopleContextValue>(
    () => ({
      label: source.label,
      people: query.data ?? [],
      isLoading: query.isPending,
      isFetching: query.isFetching,
      error: query.error,
      updatedAt: query.dataUpdatedAt || null,
      refresh: () => void query.refetch(),
    }),
    [source.label, query],
  );

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}
