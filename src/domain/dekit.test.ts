import { describe, expect, it } from "vitest";
import { InsufficientStockError, balanceKey } from "./inventory";
import { collapseDekitComponents, collapseDekitParents, planDekit } from "./dekit";
import type { AsBuiltView } from "./as-built";

const asBuilt: AsBuiltView[] = [
  {
    refType: "kit",
    refId: "kit-1",
    parentItemId: "lamp",
    parentSku: "LAMP",
    parentLotCode: null,
    parentSerial: "LAMP-1",
    componentItemId: "bulb",
    componentSku: "LED-BULB",
    componentLotCode: "LOT-A",
    componentSerial: null,
    qty: 1,
  },
  {
    refType: "kit",
    refId: "kit-1",
    parentItemId: "lamp",
    parentSku: "LAMP",
    parentLotCode: null,
    parentSerial: "LAMP-1",
    componentItemId: "shade",
    componentSku: "SHADE",
    componentLotCode: null,
    componentSerial: null,
    qty: 1,
  },
];

describe("dekit", () => {
  it("groups finished serials and component lots from as-built", () => {
    expect(collapseDekitParents(asBuilt, 1)).toEqual({
      qty: 1,
      serials: ["LAMP-1"],
      lotCode: null,
    });
    expect(collapseDekitComponents(asBuilt)).toEqual([
      expect.objectContaining({ itemId: "bulb", sku: "LED-BULB", lotCode: "LOT-A", qty: 1 }),
      expect.objectContaining({ itemId: "shade", sku: "SHADE", qty: 1, serials: null }),
    ]);
  });

  it("consumes finished from the output bay and restores components to source", () => {
    const plan = planDekit({
      kitId: "kit-1",
      finishedItemId: "lamp",
      finishedSku: "LAMP",
      qty: 1,
      sourceLocationId: "A-01-01",
      outputLocationId: "B-01-01",
      asBuilt,
      balances: new Map([
        [balanceKey("B-01-01", "lamp"), 1],
        [balanceKey("A-01-01", "bulb"), 0],
        [balanceKey("A-01-01", "shade"), 0],
      ]),
    });
    expect(plan.balances.get(balanceKey("B-01-01", "lamp"))).toBe(0);
    expect(plan.balances.get(balanceKey("A-01-01", "bulb"))).toBe(1);
    expect(plan.balances.get(balanceKey("A-01-01", "shade"))).toBe(1);
    expect(plan.movements[0]).toEqual(
      expect.objectContaining({
        type: "kit_consume",
        itemId: "lamp",
        qty: 1,
        fromLocationId: "B-01-01",
        serials: ["LAMP-1"],
        reason: "Dekit",
      }),
    );
    expect(plan.movements.filter((row) => row.type === "receive").map((row) => row.itemId).sort()).toEqual([
      "bulb",
      "shade",
    ]);
  });

  it("rejects dekit when finished goods are gone", () => {
    expect(() =>
      planDekit({
        kitId: "kit-1",
        finishedItemId: "lamp",
        finishedSku: "LAMP",
        qty: 1,
        sourceLocationId: "A-01-01",
        outputLocationId: "B-01-01",
        asBuilt,
        balances: new Map([[balanceKey("B-01-01", "lamp"), 0]]),
      }),
    ).toThrow(InsufficientStockError);
  });

  it("requires as-built rows", () => {
    expect(() =>
      planDekit({
        kitId: "kit-1",
        finishedItemId: "lamp",
        finishedSku: "LAMP",
        qty: 1,
        sourceLocationId: "A-01-01",
        outputLocationId: "B-01-01",
        asBuilt: [],
        balances: new Map(),
      }),
    ).toThrow(/as-built/);
  });
});
