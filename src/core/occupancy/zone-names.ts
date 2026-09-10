import { textValue as text } from "./extra-fields";
import type { Person } from "./types";

/**
 * Zone labels.
 *
 * The plan only knows identifiers: layer "81-82" is zones "81" and "82", full
 * stop. An id tells the person looking at the screen nothing, so every label the
 * UI paints goes through here and resolves, in order:
 *
 *     description  ->  name  ->  id
 *
 * Description and name can come from two places, in this order of authority:
 *
 *   1. The catalogue handed to the viewer (`<PlanOccupancyViewer zones={...} />`).
 *   2. The `zoneDescription` / `zoneName` fields riding along on each `Person`
 *      (the field map fills them from ZONA_DESCRIPCION / ZONA). If your
 *      detection system sends the zone description with each reading, zones
 *      name themselves with no extra wiring.
 *
 * It never returns empty: with nothing to go on, the id comes back.
 */

/** What a zone is called, from the consumer's system. Both fields optional. */
export interface ZoneInfo {
  /** Preferred label, e.g. "Galería 4 Norte — Nivel 320". */
  description?: string | null;
  /** Shorter name, used when there is no description. */
  name?: string | null;
}

/** zoneId -> zone data. A plain object or a Map, whichever you already have. */
export type ZoneCatalog =
  | Readonly<Record<string, ZoneInfo>>
  | ReadonlyMap<string, ZoneInfo>;

/** Resolves one zone id to the string shown on screen. Never empty. */
export type ZoneLabeller = (zoneId: string) => string;

/** Identity labeller: shows the raw id. The default when nothing is configured. */
export const RAW_ZONE_LABEL: ZoneLabeller = (zoneId) => zoneId;

function lookup(catalog: ZoneCatalog | undefined, zoneId: string): ZoneInfo | undefined {
  if (!catalog) return undefined;
  if (catalog instanceof Map) return catalog.get(zoneId);
  const record = catalog as Record<string, ZoneInfo>;
  // hasOwn: a zoneId like "constructor" must not pick up the prototype.
  return Object.hasOwn(record, zoneId) ? record[zoneId] : undefined;
}

/** What one reading says about its own zone, or null if it says nothing. */
export function zoneInfoFromPerson(person: Person): ZoneInfo | null {
  const description = text(person.zoneDescription);
  const name = text(person.zoneName);
  return description === null && name === null ? null : { description, name };
}

/**
 * Harvest a catalogue out of the readings themselves.
 *
 * One pass, and it merges: if one reading carries the name and another the
 * description, the zone ends up with both.
 */
export function catalogFromPeople(people: readonly Person[]): Map<string, ZoneInfo> {
  const out = new Map<string, ZoneInfo>();
  for (const person of people) {
    const current = out.get(person.zoneId);
    if (current?.description && current.name) continue;
    const info = zoneInfoFromPerson(person);
    if (!info) continue;
    out.set(
      person.zoneId,
      current
        ? {
            description: current.description ?? info.description,
            name: current.name ?? info.name,
          }
        : info,
    );
  }
  return out;
}

/**
 * Build the labeller the whole UI uses. The explicit catalogue wins; what the
 * readings carry fills the gaps; the id is the last resort.
 */
export function makeZoneLabeller(
  catalog: ZoneCatalog | undefined,
  people: readonly Person[],
): ZoneLabeller {
  const derived = catalogFromPeople(people);
  return (zoneId) => {
    const explicit = lookup(catalog, zoneId);
    const fallback = derived.get(zoneId);
    return (
      text(explicit?.description) ??
      text(explicit?.name) ??
      text(fallback?.description) ??
      text(fallback?.name) ??
      zoneId
    );
  };
}

/** Several zones as one label: "Galería 4N · Rampa Principal". */
export function formatZoneLabels(
  zoneIds: readonly string[],
  label: ZoneLabeller,
): string {
  return zoneIds.map(label).join(" · ");
}
