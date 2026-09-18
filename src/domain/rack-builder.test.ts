import { describe, expect, it } from "vitest";
import { gridPosition } from "./map-layout";
import {
  aabbOverlap,
  bayBox,
  defaultRackSpec,
  expandRack,
  groupFloorObjects,
  nextAreaCode,
  nextRackAddress,
  validateDrafts,
} from "./rack-builder";

const warehouse = { mapWidth: 42, mapDepth: 28, mapHeight: 8 };

describe("rack builder", () => {
  it("explodes a north-south rack that matches the seeded A-01 grid", () => {
    const spec = defaultRackSpec({
      aisle: "A",
      rack: "01",
      posX: 2,
      posY: 7,
      rotation: 0,
      bays: 3,
      levels: 2,
      bayWidth: 3,
      bayDepth: 4,
      bayPitch: 4,
      levelHeight: 2,
    });
    const bins = expandRack(spec);
    expect(bins).toHaveLength(6);
    expect(bins.find((row) => row.code === "A-01-01")).toMatchObject(gridPosition("A", "01", "01", 1));
    expect(bins.find((row) => row.code === "A-01-02")).toMatchObject(gridPosition("A", "01", "02", 1));
    expect(bins.find((row) => row.code === "A-01-03-2")).toMatchObject({
      ...gridPosition("A", "01", "03", 2),
      level: 2,
      aisle: "A",
      rack: "01",
      bay: "03",
    });
  });

  it("rotates bays 90° so the run grows along X", () => {
    const spec = defaultRackSpec({
      posX: 5,
      posY: 5,
      rotation: 90,
      bays: 2,
      levels: 1,
      bayWidth: 3,
      bayDepth: 4,
      bayPitch: 3,
    });
    const first = bayBox(spec, 0, 1);
    const second = bayBox(spec, 1, 1);
    expect(first).toMatchObject({ posX: 5, posY: 5, sizeX: 3, sizeY: 4 });
    expect(second.posX).toBe(8);
    expect(second.posY).toBe(5);
  });

  it("rejects overlaps and out-of-bounds racks", () => {
    const spec = defaultRackSpec({ posX: 2, posY: 7, bays: 2, levels: 1, bayPitch: 4, bayWidth: 3, bayDepth: 4 });
    const drafts = expandRack(spec);
    const existing = [{ ...drafts[0]!, id: "old", code: "Z-09-01", type: "storage" }];
    expect(validateDrafts(drafts, existing, warehouse)?.code).toBe("overlap");
    const offMap = expandRack(defaultRackSpec({ posX: 40, posY: 26, bays: 3, levels: 1 }));
    expect(validateDrafts(offMap, [], warehouse)?.code).toBe("bounds");
  });

  it("groups storage bins into rack objects with inferred pitch and levels", () => {
    const locations = expandRack(
      defaultRackSpec({
        aisle: "B",
        rack: "02",
        posX: 10,
        posY: 4,
        bays: 2,
        levels: 3,
        bayPitch: 4,
        bayWidth: 3,
        bayDepth: 4,
      }),
    ).map((row, i) => ({ ...row, id: `id-${i}`, unitsOnHand: i === 0 ? 4 : 0 }));
    const objects = groupFloorObjects(locations);
    expect(objects).toHaveLength(1);
    const rack = objects[0]!;
    expect(rack).toMatchObject({
      kind: "rack",
      id: "rack:B:02",
      occupied: true,
    });
    if (rack.kind !== "rack") throw new Error("expected rack");
    expect(rack.spec.bays).toBe(2);
    expect(rack.spec.levels).toBe(3);
    expect(rack.spec.bayPitch).toBe(4);
  });

  it("suggests the next rack and area codes", () => {
    const objects = groupFloorObjects([
      { ...expandRack(defaultRackSpec({ aisle: "A", rack: "01", bays: 1, levels: 1 }))[0]!, id: "1", type: "storage" },
      { ...expandRack(defaultRackSpec({ aisle: "A", rack: "02", bays: 1, levels: 1 }))[0]!, id: "2", type: "storage" },
    ]);
    expect(nextRackAddress(objects, "A")).toEqual({ aisle: "A", rack: "03" });
    expect(nextAreaCode([{ code: "RECV", type: "receiving", ...bayBox(defaultRackSpec(), 0, 1) }], "receiving")).toBe(
      "RECV-2",
    );
  });

  it("detects 3D overlap across levels only when volumes actually collide", () => {
    const a = { posX: 0, posY: 0, posZ: 0, sizeX: 4, sizeY: 3, sizeZ: 2 };
    const above = { posX: 0, posY: 0, posZ: 2, sizeX: 4, sizeY: 3, sizeZ: 2 };
    const beside = { posX: 4, posY: 0, posZ: 0, sizeX: 4, sizeY: 3, sizeZ: 2 };
    expect(aabbOverlap(a, above)).toBe(false);
    expect(aabbOverlap(a, beside)).toBe(false);
    expect(aabbOverlap(a, { ...a, posX: 1 })).toBe(true);
  });
});
