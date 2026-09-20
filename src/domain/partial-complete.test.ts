import { describe, expect, it } from "vitest";
import {
  OverCompleteError,
  applyPartialComplete,
  isFullyCompleted,
  remainingToComplete,
} from "./partial-complete";

describe("partial kit and work-order complete", () => {
  it("posts this-complete qty and stays open until the header is filled", () => {
    const first = applyPartialComplete({ sku: "LAMP", qty: 4, qtyCompleted: 0 }, 1);
    expect(first.postedQty).toBe(1);
    expect(first.qtyCompleted).toBe(1);
    expect(remainingToComplete(4, first.qtyCompleted)).toBe(3);
    expect(isFullyCompleted(4, first.qtyCompleted)).toBe(false);

    const rest = applyPartialComplete({ sku: "LAMP", qty: 4, qtyCompleted: first.qtyCompleted }, 3);
    expect(rest.qtyCompleted).toBe(4);
    expect(isFullyCompleted(4, rest.qtyCompleted)).toBe(true);
  });

  it("rejects an over-complete against remaining qty", () => {
    expect(() => applyPartialComplete({ sku: "LAMP", qty: 2, qtyCompleted: 1 }, 2)).toThrow(OverCompleteError);
    expect(() => applyPartialComplete({ sku: "LAMP", qty: 2, qtyCompleted: 0 }, 0)).toThrow(/positive integer/);
  });
});
