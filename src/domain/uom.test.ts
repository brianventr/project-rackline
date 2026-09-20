import { describe, expect, it } from "vitest";
import { fromStockQty, resolveLineStockQty, toStockQty, UomConversionError } from "./uom";

describe("dual UoM", () => {
  it("converts alternate units to stock pieces", () => {
    expect(toStockQty(2, 6)).toBe(12);
    expect(fromStockQty(12, 6)).toBe(2);
    expect(fromStockQty(13, 6)).toBeNull();
  });

  it("resolves body qty or altQty", () => {
    expect(resolveLineStockQty({ qty: 4 })).toBe(4);
    expect(resolveLineStockQty({ altQty: 3, altPerStock: 6 })).toBe(18);
    expect(() => resolveLineStockQty({ altQty: 1 })).toThrow(UomConversionError);
  });
});
