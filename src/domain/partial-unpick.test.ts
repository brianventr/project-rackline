import { describe, expect, it } from "vitest";
import {
  OverUnpickError,
  applyPartialUnpick,
  hasUnpickable,
  netPickSlices,
  remainingToUnpick,
  takeFromSlices,
} from "./partial-unpick";

const lamps = { lineId: "l1", sku: "LAMP", qtyPicked: 2, qtyPacked: 0 };
const packed = { lineId: "l1", sku: "LAMP", qtyPicked: 2, qtyPacked: 1 };

describe("partial unpick", () => {
  it("puts unpacked qty back and keeps packed in the box", () => {
    expect(remainingToUnpick(packed)).toBe(1);
    expect(remainingToUnpick(packed, true)).toBe(2);
    const first = applyPartialUnpick([packed], [{ lineId: "l1", qty: 1 }]);
    expect(first.next[0]?.qtyPicked).toBe(1);
    expect(first.next[0]?.qtyPacked).toBe(1);
    expect(hasUnpickable(first.next)).toBe(false);
  });

  it("lets cancel restore packed qty too", () => {
    const cancelled = applyPartialUnpick([packed], [{ lineId: "l1", qty: 2 }], true);
    expect(cancelled.next[0]?.qtyPicked).toBe(0);
    expect(cancelled.next[0]?.qtyPacked).toBe(0);
  });

  it("rejects an over-unpick against remaining picked qty", () => {
    expect(() => applyPartialUnpick([lamps], [{ lineId: "l1", qty: 3 }])).toThrow(OverUnpickError);
    expect(() => applyPartialUnpick([packed], [{ lineId: "l1", qty: 2 }])).toThrow(OverUnpickError);
  });
});

describe("pick slices", () => {
  it("takes LIFO lots and leftover weight from a pick", () => {
    const slices = [
      { itemId: "bulb", locationId: "a0102", qty: 2, lotCode: "LOT-A", serials: [], weightGrams: 200 },
      { itemId: "bulb", locationId: "a0102", qty: 3, lotCode: "LOT-B", serials: [], weightGrams: 300 },
    ];
    const { taken, rest } = takeFromSlices(slices, "bulb", 4);
    expect(taken).toEqual([
      { itemId: "bulb", locationId: "a0102", qty: 1, lotCode: "LOT-A", serials: [], weightGrams: 100 },
      { itemId: "bulb", locationId: "a0102", qty: 3, lotCode: "LOT-B", serials: [], weightGrams: 300 },
    ]);
    expect(rest).toEqual([
      { itemId: "bulb", locationId: "a0102", qty: 1, lotCode: "LOT-A", serials: [], weightGrams: 100 },
    ]);
  });

  it("nets prior unpicks off pick movements", () => {
    const remaining = netPickSlices(
      [
        { itemId: "lamp", locationId: "b0101", qty: 1, lotCode: null, serials: ["LAMP-1"], weightGrams: null },
        { itemId: "lamp", locationId: "b0101", qty: 1, lotCode: null, serials: ["LAMP-2"], weightGrams: null },
      ],
      [{ itemId: "lamp", locationId: "b0101", qty: 1, lotCode: null, serials: ["LAMP-2"], weightGrams: null }],
    );
    expect(remaining).toEqual([
      { itemId: "lamp", locationId: "b0101", qty: 1, lotCode: null, serials: ["LAMP-1"], weightGrams: null },
    ]);
  });
});
