import { describe, expect, it } from "vitest";
import { buildAsBuilt, formatAsBuiltPart } from "./as-built";

describe("as-built", () => {
  it("assigns FIFO component lots onto finished serials", () => {
    const rows = buildAsBuilt([
      {
        type: "kit_produce",
        itemId: "lamp",
        qty: 2,
        serials: ["LAMP-1", "LAMP-2"],
        refType: "kit",
        refId: "kit-1",
      },
      { type: "kit_consume", itemId: "bulb", qty: 1, lotCode: "LOT-A", refType: "kit", refId: "kit-1" },
      { type: "kit_consume", itemId: "bulb", qty: 1, lotCode: "LOT-B", refType: "kit", refId: "kit-1" },
      { type: "kit_consume", itemId: "shade", qty: 2, refType: "kit", refId: "kit-1" },
    ]);
    expect(rows.filter((row) => row.parentSerial === "LAMP-1")).toEqual([
      expect.objectContaining({
        componentItemId: "bulb",
        componentLotCode: "LOT-A",
        qty: 1,
      }),
      expect.objectContaining({
        componentItemId: "shade",
        componentLotCode: null,
        qty: 1,
      }),
    ]);
    expect(rows.filter((row) => row.parentSerial === "LAMP-2")).toEqual([
      expect.objectContaining({
        componentItemId: "bulb",
        componentLotCode: "LOT-B",
        qty: 1,
      }),
      expect.objectContaining({
        componentItemId: "shade",
        qty: 1,
      }),
    ]);
  });

  it("links a single finished serial to every BOM component", () => {
    const rows = buildAsBuilt([
      {
        type: "wo_produce",
        itemId: "lamp",
        qty: 1,
        serials: ["LAMP-9"],
        lotCode: "BUILT-1",
        refType: "work_order",
        refId: "wo-1",
      },
      { type: "wo_consume", itemId: "bulb", qty: 1, lotCode: "LOT-2026-A", refType: "work_order", refId: "wo-1" },
      { type: "wo_consume", itemId: "shade", qty: 1, refType: "work_order", refId: "wo-1" },
      { type: "wo_consume", itemId: "base", qty: 1, refType: "work_order", refId: "wo-1" },
      { type: "wo_consume", itemId: "cord", qty: 1, refType: "work_order", refId: "wo-1" },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.parentSerial === "LAMP-9" && row.parentLotCode === "BUILT-1")).toBe(true);
    expect(rows.map((row) => row.componentItemId).sort()).toEqual(["base", "bulb", "cord", "shade"]);
  });

  it("ignores receive and pick movements", () => {
    expect(
      buildAsBuilt([
        { type: "receive", itemId: "bulb", qty: 4, lotCode: "LOT-A", refType: "receipt", refId: "r1" },
        { type: "pick", itemId: "lamp", qty: 1, serials: ["LAMP-1"], refType: "order", refId: "o1" },
      ]),
    ).toEqual([]);
  });

  it("formats a component line for lookup", () => {
    expect(formatAsBuiltPart({ sku: "LED-BULB", lotCode: "LOT-2026-A", qty: 1 })).toBe("LED-BULB LOT-2026-A × 1");
    expect(formatAsBuiltPart({ sku: "LAMP", serial: "LAMP-1001" })).toBe("LAMP LAMP-1001");
  });
});
