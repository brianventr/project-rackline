import { describe, expect, it } from "vitest";
import { documentPath, normalizeBarcode, parseScan } from "./barcodes";

describe("barcodes", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeBarcode("  a-01-01 ")).toBe("A-01-01");
  });

  it("parses location and SKU prefixes", () => {
    expect(parseScan("LOC:A-01-01")).toEqual({ kind: "location", value: "A-01-01", raw: "LOC:A-01-01" });
    expect(parseScan("bin:recv")).toEqual({ kind: "location", value: "RECV", raw: "BIN:RECV" });
    expect(parseScan("SKU:LED-BULB")).toEqual({ kind: "item", value: "LED-BULB", raw: "SKU:LED-BULB" });
    expect(parseScan("ITEM:LAMP")).toEqual({ kind: "item", value: "LAMP", raw: "ITEM:LAMP" });
    expect(parseScan("ORD:DEMO1")).toEqual({ kind: "order", value: "DEMO1", raw: "ORD:DEMO1" });
    expect(parseScan("RCP-DEMO1")).toEqual({ kind: "unknown", value: "RCP-DEMO1", raw: "RCP-DEMO1" });
    expect(parseScan("A-02-01")).toEqual({ kind: "unknown", value: "A-02-01", raw: "A-02-01" });
  });

  it("maps documents onto office record routes", () => {
    expect(documentPath("order", "abc")).toBe("/outbound/orders/abc");
    expect(documentPath("receipt", "abc")).toBe("/inbound/receipts/abc");
    expect(documentPath("transfer", "abc")).toBe("/inbound/putaway/abc");
    expect(documentPath("workOrder", "abc")).toBe("/make/work-orders/abc");
    expect(documentPath("cycleCount", "abc")).toBe("/stock/counts/abc");
  });
});
