import { describe, expect, it } from "vitest";
import { backorderNumber, planShortShip, shopifyBackorderFields } from "./short-ship";

const lamp = { lineId: "l1", itemId: "lamp", sku: "LAMP", qty: 2, qtyPicked: 2, qtyPacked: 2 };

describe("planShortShip", () => {
  it("returns the unshipped remainder and drops open cartons", () => {
    const plan = planShortShip({
      status: "packed",
      lines: [lamp],
      packages: [
        { id: "box1", shippedAt: 10, lines: [{ orderLineId: "l1", qty: 1 }] },
        { id: "box2", shippedAt: null, lines: [{ orderLineId: "l1", qty: 1 }] },
      ],
    });
    expect(plan).toMatchObject({
      ok: true,
      remainder: [{ lineId: "l1", qty: 1 }],
      unpick: [{ lineId: "l1", qty: 1 }],
      dropPackageIds: ["box2"],
    });
  });

  it("refuses when nothing has shipped", () => {
    expect(
      planShortShip({
        status: "packed",
        lines: [lamp],
        packages: [{ id: "box1", shippedAt: null, lines: [{ orderLineId: "l1", qty: 2 }] }],
      }),
    ).toMatchObject({ ok: false, code: "NOTHING_SHIPPED" });
  });

  it("refuses when every ordered unit already shipped", () => {
    expect(
      planShortShip({
        status: "packing",
        lines: [{ ...lamp, qtyPicked: 2, qtyPacked: 2 }],
        packages: [{ id: "box1", shippedAt: 10, lines: [{ orderLineId: "l1", qty: 2 }] }],
      }),
    ).toMatchObject({ ok: false, code: "NO_REMAINDER" });
  });

  it("refuses a shipped or open ticket", () => {
    expect(
      planShortShip({
        status: "shipped",
        lines: [lamp],
        packages: [{ id: "box1", shippedAt: 10, lines: [{ orderLineId: "l1", qty: 1 }] }],
      }),
    ).toMatchObject({ ok: false, code: "NOT_OPEN" });
    expect(
      planShortShip({
        status: "picking",
        lines: [lamp],
        packages: [{ id: "box1", shippedAt: 10, lines: [{ orderLineId: "l1", qty: 1 }] }],
      }),
    ).toMatchObject({ ok: false, code: "NOT_OPEN" });
  });

  it("backorders only the unpicked remainder without an unpick", () => {
    const plan = planShortShip({
      status: "packing",
      lines: [{ ...lamp, qtyPicked: 1, qtyPacked: 1 }],
      packages: [{ id: "box1", shippedAt: 10, lines: [{ orderLineId: "l1", qty: 1 }] }],
    });
    expect(plan).toMatchObject({ ok: true, remainder: [{ qty: 1 }], unpick: [], dropPackageIds: [] });
  });
});

describe("backorder identity", () => {
  it("suffixes the parent number and skips collisions", () => {
    expect(backorderNumber("ORD-DFW1", [])).toBe("ORD-DFW1-BO");
    expect(backorderNumber("ORD-DFW1", ["ORD-DFW1-BO"])).toBe("ORD-DFW1-BO2");
  });

  it("keeps the Shopify fulfillment order and omits a second Shopify order id", () => {
    const fields = shopifyBackorderFields({
      source: "shopify",
      shopifyOrderGid: "gid://shopify/Order/1",
      shopifyOrderName: "#1004",
      shopifyFulfillmentOrderId: "gid://shopify/FulfillmentOrder/9",
      shopifyShopDomain: "northwind.myshopify.com",
    });
    expect(fields).toEqual({
      source: "shopify",
      shopifyOrderGid: "gid://shopify/Order/1",
      shopifyOrderName: "#1004",
      shopifyFulfillmentOrderId: "gid://shopify/FulfillmentOrder/9",
      shopifyShopDomain: "northwind.myshopify.com",
      shopifySyncStatus: "none",
    });
    expect(fields).not.toHaveProperty("shopifyOrderId");
  });
});
