import { describe, expect, it } from "vitest";
import {
  boxInZone,
  countZoneBays,
  hasFootprint,
  nextZoneCode,
  rectFromCorners,
  resolveZoneId,
  validateZoneFootprint,
  zoneForBox,
  type ZoneFootprint,
} from "./zones";

const warehouse = { mapWidth: 42, mapDepth: 28, mapHeight: 8 };
const zoneA: ZoneFootprint = { id: "za", code: "A", name: "Aisle A", posX: 1, posY: 6, sizeX: 16, sizeY: 14 };
const zoneB: ZoneFootprint = { id: "zb", code: "B", name: "Aisle B", posX: 21, posY: 6, sizeX: 8, sizeY: 14 };
const tagOnly: ZoneFootprint = { id: "zt", code: "T", name: "Tag only", posX: 0, posY: 0, sizeX: 0, sizeY: 0 };

describe("zone footprints", () => {
  it("normalises a rectangle dragged from any corner", () => {
    expect(rectFromCorners(10, 12, 4, 3)).toEqual({ posX: 4, posY: 3, sizeX: 6, sizeY: 9 });
    expect(rectFromCorners(4, 3, 10, 12)).toEqual({ posX: 4, posY: 3, sizeX: 6, sizeY: 9 });
    expect(hasFootprint(rectFromCorners(4, 3, 4, 9))).toBe(false);
  });

  it("puts a bay in the zone that holds its floor centre", () => {
    const bay = { posX: 2, posY: 7, sizeX: 4, sizeY: 3 };
    expect(boxInZone(zoneA, bay)).toBe(true);
    expect(boxInZone(zoneB, bay)).toBe(false);
    expect(boxInZone(tagOnly, bay)).toBe(false);
    // Straddling the right edge of A: centre at x=17.5 is outside A.
    expect(boxInZone(zoneA, { posX: 15, posY: 7, sizeX: 5, sizeY: 3 })).toBe(false);
    expect(zoneForBox([tagOnly, zoneB, zoneA], bay)?.id).toBe("za");
    expect(zoneForBox([zoneA, zoneB], { posX: 30, posY: 7, sizeX: 4, sizeY: 3 })).toBeNull();
  });

  it("lets drawn zones own membership and leaves hand-set tags alone", () => {
    const zones = [zoneA, zoneB, tagOnly];
    const inA = { posX: 2, posY: 7, sizeX: 4, sizeY: 3 };
    const outside = { posX: 32, posY: 7, sizeX: 8, sizeY: 10 };
    expect(resolveZoneId(zones, inA, null)).toBe("za");
    expect(resolveZoneId(zones, inA, "zt")).toBe("za");
    // Moving out of A clears A; a tag-only zone survives a move.
    expect(resolveZoneId(zones, outside, "za")).toBeNull();
    expect(resolveZoneId(zones, outside, "zt")).toBe("zt");
    expect(resolveZoneId(zones, outside, null)).toBeNull();
    // A zone id the warehouse no longer knows is kept, so a stale client never strips a tag.
    expect(resolveZoneId(zones, outside, "gone")).toBe("gone");
  });

  it("rejects thin, off-map, overlapping, and duplicate-code zones", () => {
    expect(validateZoneFootprint({ posX: 2, posY: 2, sizeX: 0, sizeY: 4 }, [], warehouse)?.code).toBe("size");
    expect(validateZoneFootprint({ posX: 40, posY: 2, sizeX: 4, sizeY: 4 }, [], warehouse)?.code).toBe("bounds");
    expect(validateZoneFootprint({ posX: 10, posY: 10, sizeX: 4, sizeY: 4 }, [zoneA], warehouse)?.code).toBe("overlap");
    expect(validateZoneFootprint({ posX: 30, posY: 2, sizeX: 4, sizeY: 4, code: "a" }, [zoneA], warehouse)?.code).toBe("code");
    // Editing A itself must not collide with A.
    expect(validateZoneFootprint({ posX: 1, posY: 6, sizeX: 17, sizeY: 14, code: "A" }, [zoneA, zoneB], warehouse, "za")).toBeNull();
    // Touching edges is not an overlap.
    expect(validateZoneFootprint({ posX: 17, posY: 6, sizeX: 4, sizeY: 14 }, [zoneA, zoneB], warehouse)).toBeNull();
    // A tag-only zone never blocks a rectangle.
    expect(validateZoneFootprint({ posX: 0, posY: 0, sizeX: 4, sizeY: 4 }, [tagOnly], warehouse)).toBeNull();
  });

  it("suggests the next free letter", () => {
    expect(nextZoneCode([])).toBe("A");
    expect(nextZoneCode([zoneA, zoneB])).toBe("C");
    const alphabet = Array.from({ length: 26 }, (_, i) => ({ code: String.fromCharCode(65 + i) }));
    expect(nextZoneCode(alphabet)).toBe("Z2");
  });

  it("counts the bays a zone holds", () => {
    expect(countZoneBays("za", [{ zoneId: "za" }, { zoneId: "zb" }, { zoneId: null }, { zoneId: "za" }])).toBe(2);
  });
});
