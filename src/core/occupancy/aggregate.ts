import type { ZoneLayer } from "../dxf/types";
import type { OccupancySnapshot, Person } from "./types";

/**
 * Distribute people across the plan's zone layers.
 *
 * A layer named "81-82" collects everyone in zone 81 plus everyone in zone 82,
 * because the drawn shape does not distinguish between them. Anyone whose zone
 * has no layer lands in `other` — that is the "otras zonas" panel, and it is
 * deliberately never silently dropped.
 *
 * Pure and cheap: call it on every data refresh.
 */
export function aggregateOccupancy(
  people: readonly Person[],
  zoneLayers: readonly ZoneLayer[],
): OccupancySnapshot {
  const byLayer: OccupancySnapshot["byLayer"] = new Map();
  // zoneId -> layer names. A zone appearing on two layers feeds both.
  const layersForZone = new Map<string, string[]>();

  for (const zl of zoneLayers) {
    byLayer.set(zl.layer, {
      layer: zl.layer,
      zoneIds: zl.zoneIds,
      count: 0,
      people: [],
    });
    for (const zoneId of zl.zoneIds) {
      const existing = layersForZone.get(zoneId);
      if (existing) existing.push(zl.layer);
      else layersForZone.set(zoneId, [zl.layer]);
    }
  }

  const otherPeople: Person[] = [];
  const otherZoneIds = new Set<string>();
  let mappedCount = 0;

  for (const person of people) {
    const targets = layersForZone.get(person.zoneId);
    if (!targets) {
      otherPeople.push(person);
      otherZoneIds.add(person.zoneId);
      continue;
    }
    mappedCount++;
    for (const layer of targets) {
      const bucket = byLayer.get(layer)!;
      bucket.people.push(person);
      bucket.count++;
    }
  }

  let maxLayerCount = 0;
  for (const bucket of byLayer.values()) {
    bucket.people.sort(byDetectedAtDesc);
    if (bucket.count > maxLayerCount) maxLayerCount = bucket.count;
  }
  otherPeople.sort(byDetectedAtDesc);

  return {
    byLayer,
    maxLayerCount,
    mappedCount,
    other: {
      count: otherPeople.length,
      people: otherPeople,
      zoneIds: [...otherZoneIds].sort(compareZoneIds),
    },
    total: people.length,
  };
}

function byDetectedAtDesc(a: Person, b: Person): number {
  return b.detectedAt.localeCompare(a.detectedAt);
}

/** Numeric-aware sort so "9" comes before "85", not after. */
export function compareZoneIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}
