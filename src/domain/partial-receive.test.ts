import { describe, expect, it } from "vitest";
import {
  OverReceiveError,
  applyPartialReceive,
  hasRemaining,
  isFullyReceived,
  remainingOnLine,
} from "./partial-receive";

const bulbs = { itemId: "bulb", sku: "LED-BULB", qtyExpected: 20, qtyReceived: 0 };
const shades = { itemId: "shade", sku: "SHADE", qtyExpected: 8, qtyReceived: 0 };

describe("partial receive", () => {
  it("posts a short receipt and leaves remainder", () => {
    const first = applyPartialReceive([bulbs, shades], [{ itemId: "bulb", qty: 12 }]);
    expect(first.posted).toEqual([{ itemId: "bulb", qty: 12 }]);
    expect(remainingOnLine(first.next[0]!)).toBe(8);
    expect(hasRemaining(first.next)).toBe(true);
    expect(isFullyReceived(first.next)).toBe(false);

    const rest = applyPartialReceive(first.next, [
      { itemId: "bulb", qty: 8 },
      { itemId: "shade", qty: 8 },
    ]);
    expect(isFullyReceived(rest.next)).toBe(true);
    expect(hasRemaining(rest.next)).toBe(false);
  });

  it("rejects an over-receive against remaining qty", () => {
    expect(() => applyPartialReceive([bulbs], [{ itemId: "bulb", qty: 21 }])).toThrow(OverReceiveError);
    expect(() => applyPartialReceive([bulbs], [{ itemId: "lamp", qty: 1 }])).toThrow(/not on this document/);
    expect(() => applyPartialReceive([bulbs], [])).toThrow(/At least one/);
  });
});
