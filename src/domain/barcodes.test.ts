import { describe, expect, it } from "vitest";
import { normalizeBarcode, parseScan } from "./barcodes";

describe("barcodes", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeBarcode("  a-01-01 ")).toBe("A-01-01");
  });

  it("parses location and SKU prefixes", () => {
    expect(parseScan("LOC:A-01-01")).toEqual({ kind: "location", value: "A-01-01", raw: "LOC:A-01-01" });
    expect(parseScan("bin:recv")).toEqual({ kind: "location", value: "RECV", raw: "BIN:RECV" });
    expect(parseScan("SKU:LED-BULB")).toEqual({ kind: "item", value: "LED-BULB", raw: "SKU:LED-BULB" });
    expect(parseScan("A-02-01")).toEqual({ kind: "unknown", value: "A-02-01", raw: "A-02-01" });
  });
});
