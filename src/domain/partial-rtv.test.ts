import { describe, expect, it } from "vitest";
import {
  OverReturnError,
  applyPartialReturn,
  hasUnreturned,
  isFullyReturned,
  remainingToReturn,
} from "./partial-rtv";

const bulbs = { itemId: "bulb", sku: "LED-BULB", qtyExpected: 4, qtyReturned: 0 };
const shades = { itemId: "shade", sku: "SHADE", qtyExpected: 2, qtyReturned: 0 };

describe("partial vendor return", () => {
  it("posts a short RTV and leaves remainder", () => {
    const first = applyPartialReturn([bulbs, shades], [{ itemId: "bulb", qty: 2 }]);
    expect(first.posted).toEqual([{ itemId: "bulb", qty: 2 }]);
    expect(remainingToReturn(first.next[0]!)).toBe(2);
    expect(hasUnreturned(first.next)).toBe(true);
    expect(isFullyReturned(first.next)).toBe(false);

    const rest = applyPartialReturn(first.next, [
      { itemId: "bulb", qty: 2 },
      { itemId: "shade", qty: 2 },
    ]);
    expect(isFullyReturned(rest.next)).toBe(true);
    expect(hasUnreturned(rest.next)).toBe(false);
  });

  it("rejects an over-return against remaining qty", () => {
    expect(() => applyPartialReturn([bulbs], [{ itemId: "bulb", qty: 5 }])).toThrow(OverReturnError);
    expect(() => applyPartialReturn([bulbs], [{ itemId: "lamp", qty: 1 }])).toThrow(/not on this document/);
    expect(() => applyPartialReturn([bulbs], [])).toThrow(/At least one/);
  });
});
