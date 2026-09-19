import { describe, expect, it } from "vitest";
import { suggestReplenishments } from "./replenishment";

describe("replenishment suggestions", () => {
  it("moves bulk into a pick face below pick min", () => {
    const suggestions = suggestReplenishments({
      items: [
        { id: "bulb", sku: "LED-BULB", name: "LED bulb", pickMin: 20 },
        { id: "lamp", sku: "LAMP", name: "Desk lamp", pickMin: 12 },
        { id: "shade", sku: "SHADE", name: "Lamp shade", pickMin: 0 },
      ],
      locations: [
        { id: "a0101", code: "A-01-01", warehouseId: "wh", slotRole: "bulk", aisle: "A", rack: "01" },
        { id: "a0102", code: "A-01-02", warehouseId: "wh", slotRole: "pick", aisle: "A", rack: "01" },
        { id: "b0101", code: "B-01-01", warehouseId: "wh", slotRole: "pick", aisle: "B", rack: "01" },
        { id: "b0101l2", code: "B-01-01-2", warehouseId: "wh", slotRole: "bulk", aisle: "B", rack: "01" },
      ],
      onHand: [
        { locationId: "a0101", itemId: "bulb", qty: 40 },
        { locationId: "a0102", itemId: "bulb", qty: 6 },
        { locationId: "b0101", itemId: "lamp", qty: 8 },
        { locationId: "b0101l2", itemId: "lamp", qty: 6 },
      ],
    });

    expect(suggestions).toEqual([
      {
        itemId: "lamp",
        sku: "LAMP",
        itemName: "Desk lamp",
        pickMin: 12,
        pickQty: 8,
        fromLocationId: "b0101l2",
        fromCode: "B-01-01-2",
        toLocationId: "b0101",
        toCode: "B-01-01",
        qty: 4,
        warehouseId: "wh",
      },
      {
        itemId: "bulb",
        sku: "LED-BULB",
        itemName: "LED bulb",
        pickMin: 20,
        pickQty: 6,
        fromLocationId: "a0101",
        fromCode: "A-01-01",
        toLocationId: "a0102",
        toCode: "A-01-02",
        qty: 14,
        warehouseId: "wh",
      },
    ]);
  });

  it("skips pick faces that are already at min or have no bulk", () => {
    expect(
      suggestReplenishments({
        items: [{ id: "bulb", sku: "LED-BULB", name: "LED bulb", pickMin: 6 }],
        locations: [
          { id: "pick", code: "A-01-02", warehouseId: "wh", slotRole: "pick", aisle: "A", rack: "01" },
          { id: "bulk", code: "A-01-01", warehouseId: "wh", slotRole: "bulk", aisle: "A", rack: "01" },
        ],
        onHand: [{ locationId: "pick", itemId: "bulb", qty: 6 }],
      }),
    ).toEqual([]);
  });
});
