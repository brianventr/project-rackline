import { describe, expect, it } from "vitest";
import {
  OverPickError,
  applyPartialPick,
  hasUnpicked,
  isFullyPicked,
  remainingToPick,
  suggestPickBay,
} from "./partial-pick";

const lamps = { lineId: "l1", sku: "LAMP", qtyOrdered: 2, qtyPicked: 0 };
const shades = { lineId: "l2", sku: "SHADE", qtyOrdered: 4, qtyPicked: 0 };

describe("partial pick", () => {
  it("posts a short pick and leaves remainder", () => {
    const first = applyPartialPick([lamps, shades], [{ lineId: "l1", qty: 1 }]);
    expect(first.posted).toEqual([{ lineId: "l1", qty: 1 }]);
    expect(remainingToPick(first.next[0]!)).toBe(1);
    expect(hasUnpicked(first.next)).toBe(true);
    expect(isFullyPicked(first.next)).toBe(false);

    const rest = applyPartialPick(first.next, [
      { lineId: "l1", qty: 1 },
      { lineId: "l2", qty: 4 },
    ]);
    expect(isFullyPicked(rest.next)).toBe(true);
    expect(hasUnpicked(rest.next)).toBe(false);
  });

  it("rejects an over-pick against remaining qty", () => {
    expect(() => applyPartialPick([lamps], [{ lineId: "l1", qty: 3 }])).toThrow(OverPickError);
    expect(() => applyPartialPick([lamps], [{ lineId: "missing", qty: 1 }])).toThrow(/not on this order/);
    expect(() => applyPartialPick([lamps], [])).toThrow(/At least one/);
  });
});

describe("suggestPickBay", () => {
  const recv = {
    locationId: "recv",
    locationCode: "RECV",
    locationName: "Dock",
    barcode: "RECV",
    qty: 20,
    type: "receiving",
  };
  const short = {
    locationId: "a1",
    locationCode: "A-01-01",
    locationName: "Aisle A 01",
    barcode: "A-01-01",
    qty: 1,
    type: "storage",
  };
  const plenty = {
    locationId: "b1",
    locationCode: "B-01-01",
    locationName: "Aisle B 01",
    barcode: "B-01-01",
    qty: 8,
    type: "storage",
  };

  it("prefers a storage bay that can cover remaining qty", () => {
    expect(suggestPickBay([recv, short, plenty], 2)?.locationCode).toBe("B-01-01");
  });

  it("falls back to the fullest storage bay when none cover remaining", () => {
    expect(suggestPickBay([short], 2)?.locationCode).toBe("A-01-01");
  });

  it("returns null when nothing is on hand", () => {
    expect(suggestPickBay([{ ...plenty, qty: 0 }], 1)).toBeNull();
    expect(suggestPickBay([], 1)).toBeNull();
  });
});
