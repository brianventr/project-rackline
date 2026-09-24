import type { WarehouseMapSize } from "./map-layout";

/** A zone as the floor sees it: a code, a name, and the rectangle it owns. A zero size means the zone is a tag only. */
export type ZoneFootprint = {
  id: string;
  code: string;
  name: string;
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
};

export type ZoneRect = { posX: number; posY: number; sizeX: number; sizeY: number };

export type FloorBox = { posX: number; posY: number; sizeX: number; sizeY: number };

export type ZoneIssue = { code: "size" | "bounds" | "overlap" | "code"; message: string };

export function hasFootprint(zone: ZoneRect): boolean {
  return zone.sizeX > 0 && zone.sizeY > 0;
}

/** The grid rectangle between two dragged corners, whichever way the drag went. */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): ZoneRect {
  const minX = Math.min(x0, x1);
  const minY = Math.min(y0, y1);
  return {
    posX: minX,
    posY: minY,
    sizeX: Math.abs(x1 - x0),
    sizeY: Math.abs(y1 - y0),
  };
}

export function rectContainsPoint(rect: ZoneRect, x: number, y: number): boolean {
  return x >= rect.posX && x < rect.posX + rect.sizeX && y >= rect.posY && y < rect.posY + rect.sizeY;
}

export function rectsOverlap(a: ZoneRect, b: ZoneRect): boolean {
  return a.posX < b.posX + b.sizeX && a.posX + a.sizeX > b.posX && a.posY < b.posY + b.sizeY && a.posY + a.sizeY > b.posY;
}

/** A bay belongs to the zone its floor centre sits in, so a bay straddling a line goes to one side only. */
export function boxInZone(zone: ZoneRect, box: FloorBox): boolean {
  if (!hasFootprint(zone)) return false;
  return rectContainsPoint(zone, box.posX + box.sizeX / 2, box.posY + box.sizeY / 2);
}

export function zoneForBox<T extends ZoneRect & { code: string }>(zones: T[], box: FloorBox): T | null {
  const drawn = zones.filter(hasFootprint).sort((a, b) => a.code.localeCompare(b.code));
  return drawn.find((zone) => boxInZone(zone, box)) ?? null;
}

/**
 * Which zone a bay should carry after it lands at `box`. Drawn zones own membership: inside one, the bay
 * joins it; leaving one clears it. A tag-only zone set by hand on Setup → Zones stays until a drawn zone
 * takes the bay.
 */
export function resolveZoneId(zones: ZoneFootprint[], box: FloorBox, currentZoneId: string | null | undefined): string | null {
  const hit = zoneForBox(zones, box);
  if (hit) return hit.id;
  if (!currentZoneId) return null;
  const current = zones.find((zone) => zone.id === currentZoneId);
  if (current && hasFootprint(current)) return null;
  return currentZoneId;
}

export function validateZoneFootprint(
  rect: ZoneRect & { code?: string },
  others: ZoneFootprint[],
  warehouse: WarehouseMapSize,
  ignoreId?: string | null,
): ZoneIssue | null {
  const rest = others.filter((zone) => zone.id !== ignoreId);
  if (rect.code) {
    const code = rect.code.trim().toUpperCase();
    if (!code) return { code: "code", message: "Give the zone a code." };
    if (rest.some((zone) => zone.code.toUpperCase() === code)) {
      return { code: "code", message: `Zone ${code} already exists. Pick another code.` };
    }
  }
  if (!Number.isInteger(rect.sizeX) || !Number.isInteger(rect.sizeY) || rect.sizeX < 1 || rect.sizeY < 1) {
    return { code: "size", message: "A zone needs at least one grid cell each way." };
  }
  if (
    rect.posX < 0 ||
    rect.posY < 0 ||
    rect.posX + rect.sizeX > warehouse.mapWidth ||
    rect.posY + rect.sizeY > warehouse.mapDepth
  ) {
    return {
      code: "bounds",
      message: `The zone leaves the warehouse (${warehouse.mapWidth}×${warehouse.mapDepth}).`,
    };
  }
  const hit = rest.filter(hasFootprint).find((zone) => rectsOverlap(rect, zone));
  if (hit) return { code: "overlap", message: `That rectangle overlaps zone ${hit.code}.` };
  return null;
}

/** The first free single letter, then Z2, Z3… once the alphabet is used. */
export function nextZoneCode(zones: Array<{ code: string }>): string {
  const taken = new Set(zones.map((zone) => zone.code.trim().toUpperCase()));
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) return letter;
  }
  for (let n = 2; n < 1000; n += 1) {
    const code = `Z${n}`;
    if (!taken.has(code)) return code;
  }
  return `Z${Date.now().toString().slice(-4)}`;
}

/** Bays that carry this zone id, for the label on the floor. */
export function countZoneBays(zoneId: string, locations: Array<{ zoneId?: string | null }>): number {
  return locations.reduce((sum, row) => sum + (row.zoneId === zoneId ? 1 : 0), 0);
}
