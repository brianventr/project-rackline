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

  const lamp = (type: "pick" | "unpick", createdAt: number, serials: string[], locationId = "b0101") => ({
    type,
    createdAt,
    itemId: "lamp",
    locationId,
    qty: serials.length,
    lotCode: null,
    serials,
    weightGrams: null,
  });

  it("nets prior unpicks off pick movements", () => {
    const remaining = netPickSlices([lamp("pick", 1, ["LAMP-1"]), lamp("pick", 1, ["LAMP-2"]), lamp("unpick", 2, ["LAMP-2"])]);
    expect(remaining).toEqual([
      { itemId: "lamp", locationId: "b0101", qty: 1, lotCode: null, serials: ["LAMP-1"], weightGrams: null },
    ]);
  });

  it("nets a pick, unpick, and re-pick of the same serial to the re-pick", () => {
    const remaining = netPickSlices([
      lamp("pick", 3, ["LAMP-1009"], "b0102"),
      lamp("unpick", 2, ["LAMP-1007"]),
      lamp("pick", 1, ["LAMP-1007"]),
      lamp("pick", 3, ["LAMP-1007"]),
    ]);
    expect(remaining.flatMap((slice) => slice.serials).sort()).toEqual(["LAMP-1007", "LAMP-1009"]);
    expect(remaining.map((slice) => slice.locationId).sort()).toEqual(["b0101", "b0102"]);
  });

  it("replays in time order so an old unpick never cancels a newer pick", () => {
    const bulb = (type: "pick" | "unpick", createdAt: number, qty: number, locationId: string, lotCode: string | null = null) => ({
      type,
      createdAt,
      itemId: "bulb",
      locationId,
      qty,
      lotCode,
      serials: [],
      weightGrams: null,
    });
    expect(netPickSlices([bulb("pick", 1, 2, "a"), bulb("unpick", 2, 2, "a"), bulb("pick", 3, 1, "b")])).toEqual([
      { itemId: "bulb", locationId: "b", qty: 1, lotCode: null, serials: [], weightGrams: null },
    ]);
    expect(
      netPickSlices([bulb("pick", 1, 2, "a", "LOT-A"), bulb("pick", 2, 2, "a", "LOT-B"), bulb("unpick", 3, 1, "a", "LOT-A")]),
    ).toEqual([
      { itemId: "bulb", locationId: "a", qty: 1, lotCode: "LOT-A", serials: [], weightGrams: null },
      { itemId: "bulb", locationId: "a", qty: 2, lotCode: "LOT-B", serials: [], weightGrams: null },
    ]);
  });
});
