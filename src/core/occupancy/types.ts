/**
 * The contract between the plan and the people-detection system.
 *
 * This is the ONLY thing the other team has to satisfy. Everything else in the
 * viewer is driven from these types — no assumptions about REST vs WebSocket vs
 * polling, and no assumption about what else a person record carries.
 */

/**
 * One person currently detected somewhere.
 *
 * `zoneId` is the field that ties a person to the plan. It must match the tokens
 * used in the DXF layer names: layer "81-82" resolves people whose `zoneId` is
 * "81" OR "82".
 */
export interface Person {
  /** Stable identity. In the reference system this is the RUT. */
  id: string;
  name: string;
  /** Zone the person is in right now. Any value, mapped or not. */
  zoneId: string;
  /** ISO-8601 timestamp of the reading that placed them here. */
  detectedAt: string;
  /**
   * Anything else your system knows: cargo, gerencia, tag, empresa, turno...
   * Surface a field in the table by adding it to PERSON_COLUMNS — see
   * `src/ui/person-columns.ts`. Nothing here is required.
   */
  extra?: Record<string, string | number | null | undefined>;
}

/** People resolved onto one DXF zone layer. */
export interface LayerOccupancy {
  /** DXF layer name, e.g. "85" or "81-82". */
  layer: string;
  /** Zone IDs the layer covers. */
  zoneIds: string[];
  count: number;
  people: Person[];
}

/** People whose zone is not drawn on this plan. */
export interface OtherOccupancy {
  count: number;
  people: Person[];
  /** Distinct zone IDs seen that have no layer, sorted. */
  zoneIds: string[];
}

export interface OccupancySnapshot {
  /** Keyed by DXF layer name. Every zone layer in the plan is present, even at 0. */
  byLayer: Map<string, LayerOccupancy>;
  /** Highest per-layer count — the denominator for the density colour scale. */
  maxLayerCount: number;
  /** People sitting on a drawn zone. */
  mappedCount: number;
  other: OtherOccupancy;
  total: number;
}

/**
 * Where people come from.
 *
 * Implement this against your API and pass it to the app. The mock in
 * `src/data/mock-people-source.ts` is the reference implementation.
 */
export interface PeopleSource {
  /** Human name shown in the header, e.g. "API producción". */
  label: string;
  /** Resolve the current set of detected people. */
  fetchPeople(signal?: AbortSignal): Promise<Person[]>;
}
