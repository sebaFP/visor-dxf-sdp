/**
 * The contract between the plan and the people-detection system.
 *
 * This is the ONLY thing the other team has to satisfy. Everything else in the
 * viewer is driven from these types — no assumptions about REST vs WebSocket vs
 * polling, and no assumption about what else a person record carries.
 *
 * You normally do not build a `Person` by hand: `mapRowsToPeople` in
 * `field-map.ts` turns the rows of your API into this shape using a field map
 * (column name → field), so renaming a column is a one-line change.
 */

/**
 * One person currently detected somewhere.
 *
 * `zoneId` is the field that ties a person to the plan. It must match the tokens
 * used in the DXF layer names: layer "81-82" resolves people whose `zoneId` is
 * "81" OR "82".
 */
export interface Person {
  /**
   * Stable identity. In the reference system this is the RUT, or the TAGID when
   * the reading carries no assigned person.
   */
  id: string;
  name: string;
  /** Zone the person is in right now. Any value, mapped or not. */
  zoneId: string;
  /**
   * ISO-8601 timestamp of the reading that placed them here, in UTC and in the
   * exact form `Date#toISOString()` produces ("2026-09-10T12:34:12.000Z").
   * The viewer sorts by comparing these strings, so the shape must be uniform;
   * `mapRowsToPeople` normalises whatever the API sends.
   */
  detectedAt: string;

  // ── Typed fields the viewer shows and filters by. All optional. ──────────
  /** Employer. Table column «Empresa» and the first filter dropdown. */
  company?: string | null;
  /** Contract code. Table column «Contrato» and the second filter dropdown. */
  contract?: string | null;
  /** Job title. Table column «Cargo». */
  role?: string | null;
  /** Speciality / discipline. Table column «Especialidad». */
  specialty?: string | null;
  /** Short zone name (ZONA). Used to label the zone when there is no description. */
  zoneName?: string | null;
  /** Zone description (ZONA_DESCRIPCION). Preferred zone label. */
  zoneDescription?: string | null;

  /**
   * Anything else your system knows (GERENCIA, TAGID, READER…). Read it with
   * `extraField(person, "GERENCIA")` — see `extra-fields.ts` — and surface it in
   * the table by adding an entry to `PERSON_COLUMNS` (`src/ui/person-columns.ts`).
   * Nothing here is required.
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
 * Implement this against your API and pass it to the app. The reference
 * implementation is `createApiPeopleSource` in `src/data/api-people-source.ts`:
 * fetch + `mapRowsToPeople`. The mock in `src/data/mock-people-source.ts` is
 * the same thing over generated rows.
 */
export interface PeopleSource {
  /** Human name shown in the header, e.g. "API producción". */
  label: string;
  /** Resolve the current set of detected people. */
  fetchPeople(signal?: AbortSignal): Promise<Person[]>;
}
