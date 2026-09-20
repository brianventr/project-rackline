import { describe, expect, it } from "vitest";
import { OverMoveError } from "./partial-transfer";
import { applyPartialReplenish, isFullyReplenished, remainingToReplenish } from "./partial-replenish";

describe("partial replenish", () => {
  it("posts this-move qty and stays open until the header is filled", () => {
    const first = applyPartialReplenish({ sku: "LED-BULB", qty: 14, qtyMoved: 0 }, 4);
    expect(first.postedQty).toBe(4);
    expect(first.qtyMoved).toBe(4);
    expect(remainingToReplenish(14, first.qtyMoved)).toBe(10);
    expect(isFullyReplenished(14, first.qtyMoved)).toBe(false);

    const rest = applyPartialReplenish({ sku: "LED-BULB", qty: 14, qtyMoved: first.qtyMoved }, 10);
    expect(rest.qtyMoved).toBe(14);
    expect(isFullyReplenished(14, rest.qtyMoved)).toBe(true);
  });

  it("rejects an over-move against remaining qty", () => {
    expect(() => applyPartialReplenish({ sku: "LED-BULB", qty: 8, qtyMoved: 6 }, 3)).toThrow(OverMoveError);
    expect(() => applyPartialReplenish({ sku: "LED-BULB", qty: 8, qtyMoved: 0 }, 0)).toThrow(/positive integer/);
  });
});
