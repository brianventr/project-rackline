import { describe, expect, it } from "vitest";
import { proposeSlotting, type SlottingBay, type SlottingStock } from "./slotting";

const bulk: SlottingBay = { locationId: "bulk", slotRole: "bulk", maxQty: null };
const pick: SlottingBay = { locationId: "pick", slotRole: "pick", maxQty: null };

function stock(locationId: string, itemId: string, qty: number): SlottingStock {
  return { locationId, itemId, qty };
}

describe("proposeSlotting", () => {
  it("proposes a fast SKU in bulk onto an empty pick face", () => {
    const moves = proposeSlotting({
      skus: [
        { itemId: "fast", units: 80 },
        { itemId: "slow", units: 5 },
      ],
      bays: [bulk, { ...pick, maxQty: 12 }],
      stock: [stock("bulk", "fast", 40)],
    });
    expect(moves).toEqual([
      { itemId: "fast", fromLocationId: "bulk", toLocationId: "pick", qty: 12, units: 80 },
    ]);
  });

  it("does not let a slower SKU kick a faster one off a pick face", () => {
    const moves = proposeSlotting({
      skus: [
        { itemId: "fast", units: 80 },
        { itemId: "slow", units: 5 },
      ],
      bays: [bulk, pick],
      stock: [stock("pick", "fast", 4), stock("bulk", "slow", 20)],
    });
    expect(moves).toEqual([]);
  });

  it("skips a SKU that is already on a pick face", () => {
    const moves = proposeSlotting({
      skus: [{ itemId: "fast", units: 80 }],
      bays: [bulk, pick, { locationId: "pick-b", slotRole: "pick", maxQty: null }],
      stock: [stock("pick", "fast", 2), stock("bulk", "fast", 50)],
    });
    expect(moves).toEqual([]);
  });

  it("moves a faster SKU onto a pick face that holds a slower one when no face is empty", () => {
    const moves = proposeSlotting({
      skus: [
        { itemId: "fast", units: 80 },
        { itemId: "slow", units: 5 },
      ],
      bays: [bulk, pick],
      stock: [stock("pick", "slow", 3), stock("bulk", "fast", 9)],
    });
    expect(moves).toEqual([
      { itemId: "fast", fromLocationId: "bulk", toLocationId: "pick", qty: 9, units: 80 },
    ]);
  });
});
