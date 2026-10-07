import { describe, expect, it } from "vitest";
import {
  PAID_WAIT_MS,
  cancelStillOpen,
  missingSkus,
  paidNotIngested,
  partialShipRisk,
} from "./order-integrity";

const NOW = 1_700_000_000_000;

describe("paid orders that never arrived", () => {
  it("waits two hours, then lists a paid order that is still missing", () => {
    const signal = { shopifyOrderId: "9", shopifyOrderName: "#1009", receivedAt: NOW - PAID_WAIT_MS };
    expect(paidNotIngested([signal], [], NOW - 1)).toEqual([]);
    expect(paidNotIngested([signal], [], NOW)).toEqual([signal]);
    expect(paidNotIngested([signal], [{ shopifyOrderId: "9" }], NOW)).toEqual([]);
  });
});

describe("cancels that stay open", () => {
  it("lists a Shopify cancel whose Rackline order is still open", () => {
    const orders = [
      { shopifyOrderId: "9", status: "open", id: "o1", number: "#1009", warehouseId: "wh" },
      { shopifyOrderId: "8", status: "cancelled", id: "o2", number: "#1008", warehouseId: "wh" },
    ];
    expect(cancelStillOpen([{ shopifyOrderId: "9", shopifyOrderName: "#1009", receivedAt: 1 }, { shopifyOrderId: "8", shopifyOrderName: "#1008", receivedAt: 1 }], orders).map((order) => order.id)).toEqual(["o1"]);
  });
});

describe("missing catalog SKUs", () => {
  it("drops a SKU once it is in the catalog", () => {
    const signal = { shopifyOrderId: "9", shopifyOrderName: "#1009", receivedAt: 1, sku: "plank-l" };
    expect(missingSkus([signal], [])).toEqual([signal]);
    expect(missingSkus([signal], ["PLANK-L"])).toEqual([]);
  });
});

describe("partial shipment risk", () => {
  it("gives the oldest order the shelf and flags the one that would ship short", () => {
    const risks = partialShipRisk(
      [
        { id: "new", number: "B", warehouseId: "wh", createdAt: 20, lines: [{ sku: "PLANK", qty: 2 }] },
        { id: "old", number: "A", warehouseId: "wh", createdAt: 10, lines: [{ sku: "plank", qty: 1 }] },
      ],
      [{ sku: "PLANK", qty: 2 }],
    );
    expect(risks.map((risk) => risk.orderId)).toEqual(["new"]);
    expect(risks[0]?.short).toEqual([{ sku: "PLANK", need: 2, have: 1 }]);
  });

  it("is quiet when the shelf covers every open order", () => {
    expect(
      partialShipRisk(
        [{ id: "o", number: "A", warehouseId: "wh", createdAt: 1, lines: [{ sku: "PLANK", qty: 1 }] }],
        [{ sku: "PLANK", qty: 1 }],
      ),
    ).toEqual([]);
  });
});
