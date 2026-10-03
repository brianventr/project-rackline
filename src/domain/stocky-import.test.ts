import { describe, expect, it } from "vitest";
import { parseStockyCsv } from "./stocky-import";

describe("Stocky CSV", () => {
  it("groups an open purchase by PO and supplier and skips a closed one", () => {
    const csv = [
      "PO Number,Supplier,Status,SKU,Product,Quantity,Received,Cost",
      "PO-9,Harbor,ordered,LED,Bulb,10,2,1.50",
      "PO-9,Harbor,ordered,SHADE,Shade,4,0,3",
      "PO-1,Harbor,closed,CORD,Cord,8,8,1",
    ].join("\n");
    const parsed = parseStockyCsv(csv);
    expect(parsed.kind).toBe("purchase");
    expect(parsed.errors).toEqual([]);
    expect(parsed.purchases).toHaveLength(1);
    expect(parsed.purchases[0]?.lines.map((line) => [line.sku, line.qtyOrdered, line.qtyReceived, line.unitCostCents])).toEqual([
      ["LED", 10, 2, 150],
      ["SHADE", 4, 0, 300],
    ]);
  });

  it("reads a stocktake counted column", () => {
    const parsed = parseStockyCsv("SKU,Product,Expected,Counted\nLED,Bulb,12,10\n");
    expect(parsed.kind).toBe("stocktake");
    expect(parsed.counts).toEqual([{ line: 2, sku: "LED", name: "Bulb", counted: 10 }]);
  });
});