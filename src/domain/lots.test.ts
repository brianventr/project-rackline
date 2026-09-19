import { describe, expect, it } from "vitest";
import { InsufficientStockError } from "./inventory";
import {
  allocateFifoLots,
  allocateSerials,
  assertSerialQty,
  builtLotCode,
  normalizeLotCode,
  parseSerialList,
} from "./lots";

describe("lots and serials", () => {
  it("allocates FIFO by lot code", () => {
    expect(
      allocateFifoLots(
        [
          { lotCode: "LOT-2026-B", qty: 15 },
          { lotCode: "LOT-2026-A", qty: 25 },
        ],
        30,
        "LED-BULB",
      ),
    ).toEqual([
      { lotCode: "LOT-2026-A", qty: 25 },
      { lotCode: "LOT-2026-B", qty: 5 },
    ]);
  });

  it("rejects a short lot allocation", () => {
    expect(() => allocateFifoLots([{ lotCode: "LOT-A", qty: 2 }], 5, "LED-BULB")).toThrow(
      InsufficientStockError,
    );
  });

  it("requires serial count to match qty", () => {
    expect(() => assertSerialQty(2, ["LAMP-1"], "LAMP")).toThrow(/needs 2 serials/);
    assertSerialQty(2, ["LAMP-1", "LAMP-2"], "LAMP");
  });

  it("parses serial lists and rejects duplicates", () => {
    expect(parseSerialList("lamp-1001, LAMP-1002\nLAMP-1003")).toEqual([
      "LAMP-1001",
      "LAMP-1002",
      "LAMP-1003",
    ]);
    expect(() => parseSerialList("A, a")).toThrow(/Duplicate serial A/);
  });

  it("takes the oldest serials first", () => {
    expect(allocateSerials(["LAMP-1008", "LAMP-1001", "LAMP-1002"], 2, "LAMP")).toEqual([
      "LAMP-1001",
      "LAMP-1002",
    ]);
  });

  it("normalizes lot codes", () => {
    expect(normalizeLotCode(" lot-2026-a ")).toBe("LOT-2026-A");
    expect(builtLotCode(new Date("2026-09-19T12:00:00Z"))).toBe("BUILT-20260919");
  });
});
