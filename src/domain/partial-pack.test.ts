import { describe, expect, it } from "vitest";
import { OverPackError, applyPartialPack, hasUnpacked, isFullyPacked, remainingToPack } from "./partial-pack";

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
