import { describe, expect, it } from "vitest";
import { expandRecallCodes, movementMatchesRecall, orderIsOpen } from "./recall";

describe("expandRecallCodes", () => {
  const links = [
    {
      parentLotCode: null,
      parentSerial: "LAMP-1001",
      componentLotCode: "LOT-2026-A",
      componentSerial: null,
    },
    {
      parentLotCode: "LOT-PARENT",
      parentSerial: null,
      componentLotCode: null,
      componentSerial: "LAMP-1001",
    },
  ];

  it("walks a component lot up to the finished serial and the next parent lot", () => {
    const codes = expandRecallCodes("lot-2026-a", links);
    expect(codes.lots.has("LOT-2026-A")).toBe(true);
    expect(codes.serials.has("LAMP-1001")).toBe(true);
    expect(codes.lots.has("LOT-PARENT")).toBe(true);
  });

  it("matches a pick by lot or by serial json", () => {
    const codes = expandRecallCodes("LOT-2026-A", links);
    expect(movementMatchesRecall({ lotCode: "LOT-PARENT", serialsJson: null }, codes.lots, codes.serials)).toBe(true);
    expect(
      movementMatchesRecall({ lotCode: null, serialsJson: JSON.stringify(["LAMP-1001"]) }, codes.lots, codes.serials),
    ).toBe(true);
    expect(movementMatchesRecall({ lotCode: "OTHER", serialsJson: null }, codes.lots, codes.serials)).toBe(false);
  });
});

describe("orderIsOpen", () => {
  it("treats shipped and cancelled as closed", () => {
    expect(orderIsOpen("packing")).toBe(true);
    expect(orderIsOpen("shipped")).toBe(false);
    expect(orderIsOpen("cancelled")).toBe(false);
  });
});
