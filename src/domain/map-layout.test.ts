import { describe, expect, it } from "vitest";
import { gridPosition, suggestPlacement } from "./map-layout";

describe("map layout", () => {
  const warehouse = { mapWidth: 42, mapDepth: 28, mapHeight: 8 };

  it("places aisle A / B racks on the seeded grid", () => {
    expect(gridPosition("A", "01", "01", 1)).toMatchObject({ posX: 2, posY: 7, posZ: 0 });
    expect(gridPosition("A", "02", "01", 1)).toMatchObject({ posX: 12, posY: 7, posZ: 0 });
    expect(gridPosition("A", "01", "02", 1)).toMatchObject({ posX: 2, posY: 11, posZ: 0 });
    expect(gridPosition("A", "01", "01", 2)).toMatchObject({ posX: 2, posY: 7, posZ: 2 });
    expect(gridPosition("B", "01", "01", 1)).toMatchObject({ posX: 22, posY: 7, posZ: 0 });
  });

  it("maps receiving, production, and shipping to floor areas", () => {
    expect(suggestPlacement([], { type: "receiving" }, warehouse)).toMatchObject({
      area: "Dock",
      posX: 2,
      posY: 1,
    });
    expect(suggestPlacement([], { type: "production" }, warehouse)).toMatchObject({
      area: "Shop",
      posX: 32,
      posY: 7,
    });
    expect(suggestPlacement([], { type: "shipping" }, warehouse)).toMatchObject({
      area: "Outbound",
      posY: 22,
    });
  });

  it("honors explicit coordinates and aisle/rack/bay addressing", () => {
    const placed = suggestPlacement(
      [],
      { type: "storage", aisle: "A", rack: "01", bay: "03", level: 2 },
      warehouse,
    );
    expect(placed).toMatchObject({
      area: "Aisle A",
      aisle: "A",
      rack: "01",
      bay: "03",
      level: 2,
      posX: 2,
      posY: 15,
      posZ: 2,
    });

    const explicit = suggestPlacement(
      [],
      { type: "storage", posX: 9, posY: 4, posZ: 0, area: "Overflow" },
      warehouse,
    );
    expect(explicit).toMatchObject({ posX: 9, posY: 4, area: "Overflow" });
  });
});
