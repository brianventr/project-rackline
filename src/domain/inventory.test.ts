import { describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  applyDelta,
  balanceKey,
  chainPlans,
  planAdjust,
  planPick,
  planReceive,
} from "./inventory";
import { explodeBom, planCompleteWorkOrder } from "./manufacturing";

describe("inventory engine", () => {
  it("receives stock into a location", () => {
    const plan = planReceive({
      itemId: "bulb",
      locationId: "A-01-01",
      qty: 10,
      refId: "rcp-1",
      balances: new Map(),
    });
    expect(plan.balances.get(balanceKey("A-01-01", "bulb"))).toBe(10);
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]?.type).toBe("receive");
  });

  it("picks down to zero and rejects a short pick", () => {
    const onHand = planReceive({
      itemId: "lamp",
      locationId: "A-01-01",
      qty: 2,
      refId: "rcp-1",
      balances: new Map(),
    });
    const picked = planPick({
      itemId: "lamp",
      sku: "LAMP",
      locationId: "A-01-01",
      qty: 2,
      refId: "ord-1",
      balances: onHand.balances,
    });
    expect(picked.balances.get(balanceKey("A-01-01", "lamp"))).toBe(0);

    expect(() =>
      planPick({
        itemId: "lamp",
        sku: "LAMP",
        locationId: "A-01-01",
        qty: 1,
        refId: "ord-2",
        balances: picked.balances,
      }),
    ).toThrow(InsufficientStockError);
  });

  it("chains multiple receipt lines onto the same bin", () => {
    const plan = chainPlans(new Map(), [
      (balances) =>
        planReceive({ itemId: "bulb", locationId: "RECV", qty: 5, refId: "r", balances }),
      (balances) =>
        planReceive({ itemId: "bulb", locationId: "RECV", qty: 7, refId: "r", balances }),
    ]);
    expect(plan.balances.get(balanceKey("RECV", "bulb"))).toBe(12);
    expect(plan.movements).toHaveLength(2);
  });

  it("applies signed adjustments and blocks negative on-hand", () => {
    const start = new Map([[balanceKey("A-01-01", "cord"), 4]]);
    const up = planAdjust({
      itemId: "cord",
      sku: "CORD",
      locationId: "A-01-01",
      qtyDelta: 2,
      reason: "found in aisle",
      refId: "adj-1",
      balances: start,
    });
    expect(up.balances.get(balanceKey("A-01-01", "cord"))).toBe(6);

    expect(() =>
      planAdjust({
        itemId: "cord",
        sku: "CORD",
        locationId: "A-01-01",
        qtyDelta: -9,
        reason: "cycle count",
        refId: "adj-2",
        balances: up.balances,
      }),
    ).toThrow(/have 6, need 9/);
  });
});

describe("work orders", () => {
  it("explodes a BOM by production quantity", () => {
    const exploded = explodeBom(
      [
        { itemId: "bulb", sku: "LED-BULB", qty: 1 },
        { itemId: "shade", sku: "SHADE", qty: 2 },
      ],
      4,
    );
    expect(exploded.map((line) => [line.sku, line.qty])).toEqual([
      ["LED-BULB", 4],
      ["SHADE", 8],
    ]);
  });

  it("consumes components and produces finished goods", () => {
    const balances = new Map<string, number>([
      [balanceKey("A-01-01", "bulb"), 10],
      [balanceKey("A-01-01", "shade"), 10],
      [balanceKey("A-01-01", "base"), 10],
      [balanceKey("A-01-01", "cord"), 10],
    ]);
    const plan = planCompleteWorkOrder({
      workOrderId: "wo-1",
      finishedItemId: "lamp",
      finishedSku: "LAMP",
      qty: 3,
      sourceLocationId: "A-01-01",
      outputLocationId: "PROD",
      bomLines: [
        { itemId: "bulb", sku: "LED-BULB", qty: 1 },
        { itemId: "shade", sku: "SHADE", qty: 1 },
        { itemId: "base", sku: "BASE", qty: 1 },
        { itemId: "cord", sku: "CORD", qty: 1 },
      ],
      balances,
    });

    expect(plan.balances.get(balanceKey("A-01-01", "bulb"))).toBe(7);
    expect(plan.balances.get(balanceKey("PROD", "lamp"))).toBe(3);
    expect(plan.movements.filter((m) => m.type === "wo_consume")).toHaveLength(4);
    expect(plan.movements.filter((m) => m.type === "wo_produce")).toHaveLength(1);
  });

  it("rejects a work order when a component is short", () => {
    const balances = new Map<string, number>([
      [balanceKey("A-01-01", "bulb"), 1],
      [balanceKey("A-01-01", "shade"), 10],
    ]);
    expect(() =>
      planCompleteWorkOrder({
        workOrderId: "wo-2",
        finishedItemId: "lamp",
        finishedSku: "LAMP",
        qty: 4,
        sourceLocationId: "A-01-01",
        outputLocationId: "PROD",
        bomLines: [
          { itemId: "bulb", sku: "LED-BULB", qty: 1 },
          { itemId: "shade", sku: "SHADE", qty: 1 },
        ],
        balances,
      }),
    ).toThrow(InsufficientStockError);
  });
});

describe("applyDelta", () => {
  it("creates a bin row from empty", () => {
    const balances = new Map<string, number>();
    applyDelta(balances, "RECV", "x", 1, "X");
    expect(balances.get(balanceKey("RECV", "x"))).toBe(1);
  });
});
