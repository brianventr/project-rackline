import { describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  applyDelta,
  balanceKey,
  chainPlans,
  planAdjust,
  planCycleCount,
  planMove,
  planPick,
  planReceive,
  planRtv,
  planScrap,
  planUnpick,
  planUnreceive,
} from "./inventory";
import { explodeBom, planCompleteKit, planCompleteWorkOrder } from "./manufacturing";

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
    expect(plan.movements[0]?.refType).toBe("receipt");

    const weighed = planReceive({
      itemId: "resin",
      locationId: "RECV",
      qty: 4,
      refId: "rcp-w",
      balances: new Map(),
      weightGrams: 2000,
    });
    expect(weighed.movements[0]?.weightGrams).toBe(2000);

    const tagged = planReceive({
      itemId: "bulb",
      locationId: "RECV",
      qty: 2,
      refId: "po-1",
      refType: "purchase",
      balances: plan.balances,
    });
    expect(tagged.movements[0]?.refType).toBe("purchase");
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

    const restored = planUnpick({
      itemId: "lamp",
      sku: "LAMP",
      locationId: "A-01-01",
      qty: 2,
      refId: "ord-1",
      balances: picked.balances,
      serials: ["LAMP-1", "LAMP-2"],
    });
    expect(restored.balances.get(balanceKey("A-01-01", "lamp"))).toBe(2);
    expect(restored.movements[0]?.type).toBe("unpick");
    expect(restored.movements[0]?.toLocationId).toBe("A-01-01");
  });

  it("unreceives dock qty without a second carton ledger", () => {
    const onDock = planReceive({
      itemId: "bulb",
      locationId: "RECV",
      qty: 10,
      refId: "asn-1",
      refType: "asn",
      balances: new Map(),
      lotCode: "LOT-2026-A",
    });
    const undone = planUnreceive({
      itemId: "bulb",
      sku: "LED-BULB",
      locationId: "RECV",
      qty: 10,
      refId: "asn-1",
      balances: onDock.balances,
      lotCode: "LOT-2026-A",
    });
    expect(undone.balances.get(balanceKey("RECV", "bulb"))).toBe(0);
    expect(undone.movements[0]).toMatchObject({
      type: "unreceive",
      fromLocationId: "RECV",
      lotCode: "LOT-2026-A",
      refType: "asn",
    });
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

  it("moves stock between bins and rejects a short move", () => {
    const start = planReceive({
      itemId: "bulb",
      locationId: "RECV",
      qty: 8,
      refId: "rcp-1",
      balances: new Map(),
    });
    const moved = planMove({
      itemId: "bulb",
      sku: "LED-BULB",
      fromLocationId: "RECV",
      toLocationId: "A-01-01",
      qty: 5,
      refId: "xfr-1",
      balances: start.balances,
    });
    expect(moved.balances.get(balanceKey("RECV", "bulb"))).toBe(3);
    expect(moved.balances.get(balanceKey("A-01-01", "bulb"))).toBe(5);
    expect(moved.movements[0]?.type).toBe("move");
    expect(moved.movements[0]?.refType).toBe("move");

    const tagged = planMove({
      itemId: "bulb",
      sku: "LED-BULB",
      fromLocationId: "RECV",
      toLocationId: "A-01-01",
      qty: 1,
      refId: "xfr-doc",
      refType: "transfer",
      balances: moved.balances,
    });
    expect(tagged.movements[0]?.refType).toBe("transfer");

    expect(() =>
      planMove({
        itemId: "bulb",
        sku: "LED-BULB",
        fromLocationId: "RECV",
        toLocationId: "A-01-01",
        qty: 4,
        refId: "xfr-2",
        balances: moved.balances,
      }),
    ).toThrow(InsufficientStockError);

    expect(() =>
      planMove({
        itemId: "bulb",
        sku: "LED-BULB",
        fromLocationId: "RECV",
        toLocationId: "RECV",
        qty: 1,
        refId: "xfr-3",
        balances: moved.balances,
      }),
    ).toThrow(/must differ/);
  });

  it("posts cycle-count variances and ignores matched lines", () => {
    const start = new Map([[balanceKey("A-01-01", "cord"), 4]]);
    const plan = planCycleCount({
      refId: "cc-1",
      locationId: "A-01-01",
      balances: start,
      lines: [
        { itemId: "cord", sku: "CORD", systemQty: 4, countedQty: 4 },
        { itemId: "bulb", sku: "LED-BULB", systemQty: 0, countedQty: 2 },
      ],
    });
    expect(plan.balances.get(balanceKey("A-01-01", "cord"))).toBe(4);
    expect(plan.balances.get(balanceKey("A-01-01", "bulb"))).toBe(2);
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]?.reason).toMatch(/0 → 2/);
  });

  it("confirms an empty bay with no movements", () => {
    const plan = planCycleCount({
      refId: "cc-empty",
      locationId: "B-01-01",
      balances: new Map(),
      lines: [],
    });
    expect(plan.movements).toHaveLength(0);
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

  it("kits consume components with kit movement types", () => {
    const balances = new Map<string, number>([
      [balanceKey("A-01-01", "bulb"), 4],
      [balanceKey("A-01-01", "shade"), 4],
    ]);
    const plan = planCompleteKit({
      kitId: "kit-1",
      finishedItemId: "lamp",
      finishedSku: "LAMP",
      qty: 1,
      sourceLocationId: "A-01-01",
      outputLocationId: "B-01-01",
      bomLines: [
        { itemId: "bulb", sku: "LED-BULB", qty: 1 },
        { itemId: "shade", sku: "SHADE", qty: 1 },
      ],
      balances,
    });
    expect(plan.movements.map((m) => m.type)).toEqual(["kit_consume", "kit_consume", "kit_produce"]);
    expect(plan.movements.every((m) => m.refType === "kit")).toBe(true);
    expect(plan.balances.get(balanceKey("B-01-01", "lamp"))).toBe(1);
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

describe("vendor RTV", () => {
  it("decrements the from bay like a pick", () => {
    const start = planReceive({
      itemId: "bulb",
      locationId: "A-01-01",
      qty: 6,
      refId: "seed",
      balances: new Map(),
    });
    const posted = planRtv({
      itemId: "bulb",
      sku: "LED-BULB",
      locationId: "A-01-01",
      qty: 2,
      refId: "rtv-1",
      balances: start.balances,
    });
    expect(posted.balances.get(balanceKey("A-01-01", "bulb"))).toBe(4);
    expect(posted.movements[0]?.type).toBe("rtv");
    expect(posted.movements[0]?.refType).toBe("vendor_return");
  });
});

describe("return scrap", () => {
  it("receives then scraps so on-hand is unchanged", () => {
    const plan = chainPlans(new Map([[balanceKey("RECV", "shade"), 4]]), [
      (balances) =>
        planReceive({
          itemId: "shade",
          locationId: "RECV",
          qty: 1,
          refId: "rma-1",
          refType: "return",
          balances,
        }),
      (balances) =>
        planScrap({
          itemId: "shade",
          sku: "SHADE",
          locationId: "RECV",
          qty: 1,
          refId: "rma-1",
          balances,
        }),
    ]);
    expect(plan.balances.get(balanceKey("RECV", "shade"))).toBe(4);
    expect(plan.movements.map((row) => row.type)).toEqual(["receive", "scrap"]);
    expect(plan.movements[1]?.reason).toBe("Return scrap");
  });
});

describe("bin moves", () => {
  it("moves a full bin onto another location", () => {
    const start = new Map([
      [balanceKey("A-01-01", "bulb"), 40],
      [balanceKey("A-01-01", "shade"), 20],
    ]);
    const moved = chainPlans(start, [
      (balances) =>
        planMove({
          itemId: "bulb",
          sku: "LED-BULB",
          qty: 40,
          fromLocationId: "A-01-01",
          toLocationId: "A-02-01",
          refId: "move-1",
          balances,
        }),
      (balances) =>
        planMove({
          itemId: "shade",
          sku: "SHADE",
          qty: 20,
          fromLocationId: "A-01-01",
          toLocationId: "A-02-01",
          refId: "move-1",
          balances,
        }),
    ]);
    expect(moved.balances.get(balanceKey("A-01-01", "bulb"))).toBe(0);
    expect(moved.balances.get(balanceKey("A-02-01", "bulb"))).toBe(40);
    expect(moved.balances.get(balanceKey("A-02-01", "shade"))).toBe(20);
    expect(moved.movements.every((m) => m.type === "move")).toBe(true);
  });

  it("rejects a move onto the same bay and a short move", () => {
    expect(() =>
      planMove({
        itemId: "cord",
        sku: "CORD",
        qty: 1,
        fromLocationId: "A-01-01",
        toLocationId: "A-01-01",
        refId: "move-2",
        balances: new Map([[balanceKey("A-01-01", "cord"), 4]]),
      }),
    ).toThrow(/must differ/);

    expect(() =>
      planMove({
        itemId: "cord",
        sku: "CORD",
        qty: 5,
        fromLocationId: "A-01-01",
        toLocationId: "SHIP",
        refId: "move-3",
        balances: new Map([[balanceKey("A-01-01", "cord"), 4]]),
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
