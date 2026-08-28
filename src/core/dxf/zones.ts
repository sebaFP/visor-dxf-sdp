/**
 * Layer-name convention used by the plan files.
 *
 *   "0"              -> the base drawing (walls, text, everything you see behind)
 *   "85"             -> a zone layer covering zone 85
 *   "81-82"          -> ONE drawn shape covering zones 81 and 82
 *   "75-142-128-207" -> same idea, four zones
 *
 * A layer may own several rings; "15-212" owns 4 in the sample plan. Every ring
 * on a layer counts as part of the same zone group.
 */

export const BASE_LAYER = "0";

/** Zone IDs are opaque tokens. Loosen this if your system uses other characters. */
const ZONE_ID = /^[A-Za-z0-9_.]+$/;

/**
 * Split a layer name into the zone IDs it represents.
 * Returns null when the layer is not a zone layer at all.
 */
export function parseZoneLayer(layer: string): string[] | null {
  const name = layer.trim();
  if (!name || name === BASE_LAYER) return null;

  const parts = name.split("-");
  if (!parts.every((p) => ZONE_ID.test(p))) return null;

  // Drop duplicates but keep the order written in the layer name.
  return [...new Set(parts)];
}

/** Human label for a zone group: "81-82" reads as "Zonas 81 · 82". */
export function formatZoneIds(zoneIds: string[]): string {
  return zoneIds.join(" · ");
}
