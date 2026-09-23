import { describe, expect, it } from "vitest";
import { EDI_INBOX_LINES, REFUSED_PAYLOAD_MAX, refusedPayloadJson, summarizeEdiPayload } from "./edi-inbox";

const EMPTY = { vendorName: null, reference: null, lineCount: 0, lines: [] };

describe("summarizeEdiPayload", () => {
  it("reads a processed payload", () => {
    const stored = JSON.stringify({
      warehouseId: "wh-1",
      vendorName: "Harbor Components",
      clientCode: "ACME",
      reference: "PO-778",
      lines: [
        { sku: "LED-BULB", qty: 12 },
        { sku: "LAMP", qty: 2 },
      ],
    });
    expect(summarizeEdiPayload(stored)).toEqual({
      vendorName: "Harbor Components",
      reference: "PO-778",
      lineCount: 2,
      lines: [
        { sku: "LED-BULB", qty: 12 },
        { sku: "LAMP", qty: 2 },
      ],
    });
  });

  it("returns an empty summary for null, empty or non-JSON input", () => {
    expect(summarizeEdiPayload(null)).toEqual(EMPTY);
    expect(summarizeEdiPayload(undefined)).toEqual(EMPTY);
    expect(summarizeEdiPayload("")).toEqual(EMPTY);
    expect(summarizeEdiPayload("not json {")).toEqual(EMPTY);
    expect(summarizeEdiPayload("null")).toEqual(EMPTY);
  });

  it("returns an empty summary when the body is not an object", () => {
    expect(summarizeEdiPayload("42")).toEqual(EMPTY);
    expect(summarizeEdiPayload('"ASN"')).toEqual(EMPTY);
    expect(summarizeEdiPayload("true")).toEqual(EMPTY);
    expect(summarizeEdiPayload(JSON.stringify([{ sku: "LAMP", qty: 1 }]))).toEqual(EMPTY);
  });

  it("trims text fields and drops blank or non-string ones", () => {
    const stored = JSON.stringify({ vendorName: "  Harbor  ", reference: "   ", lines: [] });
    expect(summarizeEdiPayload(stored)).toMatchObject({ vendorName: "Harbor", reference: null });
    expect(summarizeEdiPayload(JSON.stringify({ vendorName: 7, reference: { id: 1 } }))).toMatchObject({
      vendorName: null,
      reference: null,
    });
  });

  it("treats a non-array lines field as no lines", () => {
    expect(summarizeEdiPayload(JSON.stringify({ vendorName: "Harbor", lines: "LAMP x2" }))).toMatchObject({
      lineCount: 0,
      lines: [],
    });
    expect(summarizeEdiPayload(JSON.stringify({ lines: { sku: "LAMP", qty: 1 } }))).toMatchObject({
      lineCount: 0,
      lines: [],
    });
  });

  it("skips junk line entries but counts every entry the supplier sent", () => {
    const stored = JSON.stringify({
      lines: [
        null,
        7,
        "LAMP",
        ["LAMP", 2],
        { qty: 3 },
        { sku: 42, qty: 1 },
        { sku: "   ", qty: 1 },
        { sku: " led-bulb ", qty: 4 },
      ],
    });
    expect(summarizeEdiPayload(stored)).toEqual({
      vendorName: null,
      reference: null,
      lineCount: 8,
      lines: [{ sku: "LED-BULB", qty: 4 }],
    });
  });

  it("reads a numeric-string qty and shows any other qty as 0", () => {
    const stored = JSON.stringify({
      lines: [
        { sku: "A", qty: "6" },
        { sku: "B", qty: "12 cases" },
        { sku: "C", qty: true },
        { sku: "D", qty: null },
        { sku: "E" },
        { sku: "F", qty: [5] },
        { sku: "G", qty: "" },
        { sku: "H", qty: -3 },
        { sku: "I", qty: 2.5 },
      ],
    });
    expect(summarizeEdiPayload(stored).lines).toEqual([
      { sku: "A", qty: 6 },
      { sku: "B", qty: 0 },
      { sku: "C", qty: 0 },
      { sku: "D", qty: 0 },
      { sku: "E", qty: 0 },
      { sku: "F", qty: 0 },
      { sku: "G", qty: 0 },
      { sku: "H", qty: -3 },
      { sku: "I", qty: 2.5 },
    ]);
  });

  it(`echoes at most ${EDI_INBOX_LINES} lines and still counts them all`, () => {
    const lines = Array.from({ length: 120 }, (_, index) => ({ sku: `SKU-${index}`, qty: index + 1 }));
    const summary = summarizeEdiPayload(JSON.stringify({ vendorName: "Harbor", lines }));
    expect(summary.lineCount).toBe(120);
    expect(summary.lines).toHaveLength(EDI_INBOX_LINES);
    expect(summary.lines[0]).toEqual({ sku: "SKU-0", qty: 1 });
    expect(summary.lines.at(-1)).toEqual({ sku: `SKU-${EDI_INBOX_LINES - 1}`, qty: EDI_INBOX_LINES });
  });

  it("fills the cap with readable lines, skipping junk before it", () => {
    const lines = [null, { qty: 1 }, ...Array.from({ length: 60 }, (_, index) => ({ sku: `S${index}`, qty: 1 }))];
    const summary = summarizeEdiPayload(JSON.stringify({ lines }));
    expect(summary.lineCount).toBe(62);
    expect(summary.lines).toHaveLength(EDI_INBOX_LINES);
    expect(summary.lines[0]?.sku).toBe("S0");
  });

  it("reads the truncated stub a too-big refused body is stored as", () => {
    const stored = JSON.stringify({ truncated: true, vendorName: "Harbor", reference: "PO-1", lineCount: 4000 });
    expect(summarizeEdiPayload(stored)).toEqual({ vendorName: "Harbor", reference: "PO-1", lineCount: 4000, lines: [] });
  });

  it("ignores a bad count on the truncated stub", () => {
    for (const lineCount of [-1, 2.5, "4000", null]) {
      expect(summarizeEdiPayload(JSON.stringify({ truncated: true, lineCount })).lineCount).toBe(0);
    }
  });

  it("ignores a lineCount the supplier sent on an ordinary body", () => {
    const lines = [
      { sku: "A", qty: 1 },
      { sku: "B", qty: 2 },
      { sku: "C", qty: 3 },
    ];
    expect(summarizeEdiPayload(JSON.stringify({ lineCount: 0, lines })).lineCount).toBe(3);
    expect(summarizeEdiPayload(JSON.stringify({ lineCount: 99, lines })).lineCount).toBe(3);
    expect(summarizeEdiPayload(JSON.stringify({ truncated: "yes", lineCount: 99, lines })).lineCount).toBe(3);
    expect(summarizeEdiPayload(JSON.stringify({ lineCount: 5 })).lineCount).toBe(0);
  });
});

describe("refusedPayloadJson", () => {
  it("keeps a body that fits as sent", () => {
    const raw = { vendorName: "Harbor", lines: [{ sku: "NOPE", qty: 1 }], extra: { note: "hi" } };
    expect(JSON.parse(refusedPayloadJson(raw))).toEqual(raw);
    expect(refusedPayloadJson([1, 2])).toBe("[1,2]");
    expect(refusedPayloadJson("text")).toBe('"text"');
  });

  it("stores null when there is no body or it cannot be serialized", () => {
    expect(refusedPayloadJson(null)).toBe("null");
    expect(refusedPayloadJson(undefined)).toBe("null");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(refusedPayloadJson(loop)).toBe("null");
    expect(refusedPayloadJson({ big: BigInt(1) })).toBe("null");
  });

  it("stores a stub with the headline fields when the body is too big", () => {
    const lines = Array.from({ length: 2000 }, (_, index) => ({ sku: `SKU-${index}`, qty: 1, note: "x".repeat(20) }));
    const raw = { vendorName: " Harbor ", reference: "R".repeat(300), lines };
    const stored = refusedPayloadJson(raw);
    expect(JSON.stringify(raw).length).toBeGreaterThan(REFUSED_PAYLOAD_MAX);
    expect(stored.length).toBeLessThan(REFUSED_PAYLOAD_MAX);
    expect(JSON.parse(stored)).toEqual({ truncated: true, vendorName: "Harbor", reference: null, lineCount: 2000 });
    expect(summarizeEdiPayload(stored)).toEqual({ vendorName: "Harbor", reference: null, lineCount: 2000, lines: [] });
  });

  it("counts no lines on a too-big body that is not an ASN shape", () => {
    const stored = refusedPayloadJson(["x".repeat(REFUSED_PAYLOAD_MAX)]);
    expect(JSON.parse(stored)).toEqual({ truncated: true, vendorName: null, reference: null, lineCount: 0 });
  });
});
