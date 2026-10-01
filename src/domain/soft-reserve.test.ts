import { describe, expect, it } from "vitest";
import type { StockedBay } from "./partial-pick";
import {
  applyOwnerSoftHolds,
  applySoftHoldsToOnHand,
  planSoftReserves,
  reduceQtyAcrossBays,
  reserveQtyToStore,
} from "./soft-reserve";

function bay(partial: Partial<StockedBay> & { locationId: string; qty: number }): StockedBay {
  return {
    locationCode: partial.locationId,
    locationName: partial.locationId,
    barcode: partial.locationId,
    ...partial,
  };
}

describe("planSoftReserves", () => {
  it("reserves what ATP can cover and leaves the rest unreserved", () => {
    const plan = planSoftReserves({
      lines: [{ lineId: "l1", itemId: "item", sku: "LAMP", qty: 8 }],
      atpByItem: new Map([["item", 5]]),
    });
    expect(plan.reserves).toEqual([{ lineId: "l1", itemId: "item", sku: "LAMP", qty: 5 }]);
    expect(plan.short).toEqual([
      { lineId: "l1", itemId: "item", sku: "LAMP", needed: 8, reserved: 5, shortQty: 3 },
    ]);
  });

  it("plans the same absolute qty on a second pass, so a repeat ingest does not double", () => {
    const input = {
      lines: [{ lineId: "l1", itemId: "item", sku: "LAMP", qty: 4 }],
      atpByItem: new Map([["item", 10]]),
    };
    const first = planSoftReserves(input);
    const second = planSoftReserves(input);
    expect(first.reserves[0]?.qty).toBe(4);
    expect(second.reserves[0]?.qty).toBe(4);
    expect(reserveQtyToStore(first.reserves[0]!.qty, second.reserves[0]!.qty)).toBe(4);
    expect(reserveQtyToStore(4, 4)).not.toBe(8);
  });

  it("shares one item's ATP across lines and does not reserve a line with no ATP", () => {
    const plan = planSoftReserves({
      lines: [
        { lineId: "a", itemId: "item", sku: "LAMP", qty: 6 },
        { lineId: "b", itemId: "item", sku: "LAMP", qty: 6 },
      ],
      atpByItem: new Map([["item", 10]]),
    });
    expect(plan.reserves.map((row) => row.qty)).toEqual([6, 4]);
    expect(plan.short).toEqual([
      { lineId: "b", itemId: "item", sku: "LAMP", needed: 6, reserved: 4, shortQty: 2 },
    ]);
  });

  it("ingests a fully short line as unreserved", () => {
    const plan = planSoftReserves({
      lines: [{ lineId: "l1", itemId: "item", sku: "LAMP", qty: 3 }],
      atpByItem: new Map([["item", 0]]),
    });
    expect(plan.reserves).toEqual([]);
    expect(plan.short[0]?.shortQty).toBe(3);
  });
});

describe("applySoftHoldsToOnHand", () => {
  it("reduces ATP by the hold without naming a bay on the hold", () => {
    const rows = [
      { locationId: "b", itemId: "item", qty: 4 },
      { locationId: "a", itemId: "item", qty: 6 },
    ];
    const hold = { itemId: "item", orderId: "ord", qty: 3 };
    expect(hold).not.toHaveProperty("locationId");
    const next = applySoftHoldsToOnHand(rows, [hold]);
    expect(next.reduce((sum, row) => sum + row.qty, 0)).toBe(7);
    const again = applySoftHoldsToOnHand(rows, [hold], "ord");
    expect(again.reduce((sum, row) => sum + row.qty, 0)).toBe(10);
  });

  it("takes units in location order so the same shelf always gives up the same qty", () => {
    const next = reduceQtyAcrossBays(
      [
        { locationId: "b", qty: 4 },
        { locationId: "a", qty: 2 },
      ],
      3,
    );
    expect(next).toEqual([
      { locationId: "b", qty: 3 },
      { locationId: "a", qty: 0 },
    ]);
  });
});

describe("applyOwnerSoftHolds", () => {
  it("lets a client hold reduce only that client's pool", () => {
    const bays = new Map<string, StockedBay[]>([
      ["item", [bay({ locationId: "own-bay", qty: 8 }), bay({ locationId: "client-bay", qty: 5 })]],
    ]);
    const holds = [{ itemId: "item", orderId: "c-order", clientId: "client-1", qty: 5 }];
    const own = applyOwnerSoftHolds(bays, holds, { owner: null });
    const client = applyOwnerSoftHolds(bays, holds, { owner: "client-1" });
    const self = applyOwnerSoftHolds(bays, holds, { owner: "client-1", excludeOrderId: "c-order" });
    expect(own.get("item")?.reduce((sum, row) => sum + row.qty, 0)).toBe(13);
    expect(client.get("item")?.reduce((sum, row) => sum + row.qty, 0)).toBe(8);
    expect(self.get("item")?.reduce((sum, row) => sum + row.qty, 0)).toBe(13);
  });
});
