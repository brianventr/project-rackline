import { describe, expect, it } from "vitest";
import { EdiParseError, parseEdiAsnBody } from "./edi";

describe("edi asn parse", () => {
  it("normalizes sku and optional client code", () => {
    const payload = parseEdiAsnBody({
      warehouseId: "wh1",
      vendorName: "Harbor",
      clientCode: "acme",
      lines: [{ sku: "resin", qty: 2 }],
    });
    expect(payload.lines[0]?.sku).toBe("RESIN");
    expect(payload.clientCode).toBe("ACME");
  });

  it("rejects empty lines", () => {
    expect(() => parseEdiAsnBody({ warehouseId: "w", vendorName: "v", lines: [] })).toThrow(EdiParseError);
  });
});
