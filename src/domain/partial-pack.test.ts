import { describe, expect, it } from "vitest";
import {
  OverPackError,
  applyPartialPack,
  hasUnpacked,
  isFullyPacked,
  packUnitScan,
  remainingToPack,
  type PackStationLine,
} from "./partial-pack";

const lamps = { lineId: "l1", sku: "LAMP", qtyPicked: 2, qtyPacked: 0 };
const shades = { lineId: "l2", sku: "SHADE", qtyPicked: 4, qtyPacked: 0 };

describe("partial pack", () => {
  it("posts a short pack and leaves remainder", () => {
    const first = applyPartialPack([lamps, shades], [{ lineId: "l1", qty: 1 }]);
    expect(first.posted).toEqual([{ lineId: "l1", qty: 1 }]);
    expect(remainingToPack(first.next[0]!)).toBe(1);
    expect(hasUnpacked(first.next)).toBe(true);
    expect(isFullyPacked(first.next)).toBe(false);

    const rest = applyPartialPack(first.next, [
      { lineId: "l1", qty: 1 },
      { lineId: "l2", qty: 4 },
    ]);
    expect(isFullyPacked(rest.next)).toBe(true);
    expect(hasUnpacked(rest.next)).toBe(false);
  });

  it("rejects an over-pack against remaining picked qty", () => {
    expect(() => applyPartialPack([lamps], [{ lineId: "l1", qty: 3 }])).toThrow(OverPackError);
    expect(() => applyPartialPack([lamps], [{ lineId: "missing", qty: 1 }])).toThrow(/not on this order/);
    expect(() => applyPartialPack([lamps], [])).toThrow(/At least one/);
  });

  it("cannot pack more than was picked", () => {
    expect(remainingToPack({ lineId: "l1", sku: "LAMP", qtyPicked: 1, qtyPacked: 0 })).toBe(1);
    expect(() => applyPartialPack([{ ...lamps, qtyPicked: 1 }], [{ lineId: "l1", qty: 2 }])).toThrow(OverPackError);
  });
});

describe("pack station unit scans", () => {
  const lamp = { itemId: "i-lamp", sku: "LAMP" };
  const station = (inPack: number[]): PackStationLine[] => [
    { lineId: "l1", itemId: "i-lamp", sku: "LAMP", remaining: 2, inPack: inPack[0] ?? 0 },
    { lineId: "l2", itemId: "i-shade", sku: "SHADE", remaining: 0, inPack: inPack[1] ?? 0 },
    { lineId: "l3", itemId: "i-lamp", sku: "LAMP", remaining: 1, inPack: inPack[2] ?? 0 },
  ];

  it("adds one per scan, then moves on to the next line for the same item", () => {
    expect(packUnitScan(station([0]), lamp, 0)).toEqual({ ok: true, add: { lineId: "l1", qty: 1 } });
    expect(packUnitScan(station([1]), lamp, 1)).toEqual({ ok: true, add: { lineId: "l1", qty: 2 } });
    expect(packUnitScan(station([2]), lamp, 2)).toEqual({ ok: true, add: { lineId: "l3", qty: 1 } });
  });

  it("matches the line by SKU when the item id differs", () => {
    expect(packUnitScan(station([0]), { itemId: "other", sku: "lamp" }, 0)).toEqual({ ok: true, add: { lineId: "l1", qty: 1 } });
  });

  it("refuses a unit that is not on the order, already packed, or one too many", () => {
    expect(packUnitScan(station([]), { itemId: "i-cord", sku: "CORD" }, 0)).toEqual({ ok: false, problem: "CORD is not on this order." });
    expect(packUnitScan(station([]), { itemId: "i-shade", sku: "SHADE" }, 0)).toEqual({ ok: false, problem: "SHADE is already packed." });
    expect(packUnitScan(station([2, 0, 1]), lamp, 3)).toEqual({
      ok: false,
      problem: "All 3 LAMP left to pack are already scanned.",
    });
  });

  it("catches up scans behind a typed qty before adding more", () => {
    expect(packUnitScan(station([2]), lamp, 0)).toEqual({ ok: true, add: null });
    expect(packUnitScan(station([2]), lamp, 1)).toEqual({ ok: true, add: null });
    expect(packUnitScan(station([2]), lamp, 2)).toEqual({ ok: true, add: { lineId: "l3", qty: 1 } });
  });
});
