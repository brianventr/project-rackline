import { describe, expect, it } from "vitest";
import { documentPath, normalizeBarcode, parseGs1, parseScan } from "./barcodes";

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
    expect(parseScan("PO:DEMO1")).toEqual({ kind: "purchase", value: "DEMO1", raw: "PO:DEMO1" });
    expect(parseScan("RMA:DEMO1")).toEqual({ kind: "rma", value: "DEMO1", raw: "RMA:DEMO1" });
    expect(parseScan("RTV:DEMO1")).toEqual({ kind: "vendorReturn", value: "DEMO1", raw: "RTV:DEMO1" });
    expect(parseScan("RPL:DEMO1")).toEqual({ kind: "replenishment", value: "DEMO1", raw: "RPL:DEMO1" });
    expect(parseScan("KIT:DEMO1")).toEqual({ kind: "kit", value: "DEMO1", raw: "KIT:DEMO1" });
    expect(parseScan("HLD:DEMO1")).toEqual({ kind: "hold", value: "DEMO1", raw: "HLD:DEMO1" });
    expect(parseScan("WAV:DEMO1")).toEqual({ kind: "wave", value: "DEMO1", raw: "WAV:DEMO1" });
    expect(parseScan("ASN:DEMO1")).toEqual({ kind: "asn", value: "DEMO1", raw: "ASN:DEMO1" });
    expect(parseScan("BOX:1")).toEqual({ kind: "package", value: "1", raw: "BOX:1" });
    expect(parseScan("SSCC:000123")).toEqual({ kind: "package", value: "000123", raw: "SSCC:000123" });
    expect(parseScan("YRD:DEMO1")).toEqual({ kind: "yard", value: "DEMO1", raw: "YRD:DEMO1" });
    expect(parseScan("EQ:FL-01")).toEqual({ kind: "equipment", value: "FL-01", raw: "EQ:FL-01" });
    expect(parseScan("SN:LAMP-1001")).toEqual({ kind: "serial", value: "LAMP-1001", raw: "SN:LAMP-1001" });
    expect(parseScan("LOT:2026-A")).toEqual({ kind: "lot", value: "2026-A", raw: "LOT:2026-A" });
    expect(parseScan("RCP-DEMO1")).toEqual({ kind: "unknown", value: "RCP-DEMO1", raw: "RCP-DEMO1" });
    expect(parseScan("A-02-01")).toEqual({ kind: "unknown", value: "A-02-01", raw: "A-02-01" });
  });

  it("parses GS1 AI payloads", () => {
    expect(parseGs1("(01)01234567890128(10)LOT42(21)SER99")).toEqual({
      gtin: "01234567890128",
      lot: "LOT42",
      serial: "SER99",
    });
    expect(parseScan("010123456789012810LOT42")).toMatchObject({
      kind: "item",
      value: "01234567890128",
      gs1: { gtin: "01234567890128", lot: "LOT42" },
    });
  });

  it("maps documents onto office record routes", () => {
    expect(documentPath("order", "abc")).toBe("/outbound/orders/abc");
    expect(documentPath("receipt", "abc")).toBe("/inbound/receipts/abc");
    expect(documentPath("transfer", "abc")).toBe("/inbound/putaway/abc");
    expect(documentPath("workOrder", "abc")).toBe("/make/work-orders/abc");
    expect(documentPath("cycleCount", "abc")).toBe("/stock/counts/abc");
    expect(documentPath("purchase", "abc")).toBe("/inbound/purchases/abc");
    expect(documentPath("rma", "abc")).toBe("/outbound/returns/abc");
    expect(documentPath("vendorReturn", "abc")).toBe("/inbound/vendor-returns/abc");
    expect(documentPath("replenishment", "abc")).toBe("/stock/replenish/abc");
    expect(documentPath("kit", "abc")).toBe("/make/kits/abc");
    expect(documentPath("hold", "abc")).toBe("/stock/holds/abc");
    expect(documentPath("wave", "abc")).toBe("/outbound/waves/abc");
    expect(documentPath("asn", "abc")).toBe("/inbound/asns/abc");
    expect(documentPath("package", "abc")).toBe("/inbound/asns/abc");
    expect(documentPath("yard", "abc")).toBe("/inbound/yard/abc");
    expect(documentPath("equipment", "abc")).toBe("/equipment/abc");
  });
});
