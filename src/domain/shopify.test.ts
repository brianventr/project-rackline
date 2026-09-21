import { describe, expect, it } from "vitest";
import {
  applyFulfillmentOrderIds,
  buildDemoOrderPayload,
  buildFulfillmentCreateInput,
  demoFulfillmentIds,
  mapFulfillmentOrder,
  mapRestOrder,
  normalizeShopDomain,
  shopifyHmac,
  shopifyTrackingInfo,
  fulfillmentLineItemsForPackage,
  verifyShopifyHmac,
  REQUIRED_SCOPES,
  buildInventorySetQuantitiesInput,
} from "./shopify";

const paidLampOrder = {
  id: 1004,
  admin_graphql_api_id: "gid://shopify/Order/1004",
  name: "#1004",
  email: "maya@harbor.studio",
  cancelled_at: null,
  fulfillment_status: null,
  financial_status: "paid",
  customer: { first_name: "Maya", last_name: "Chen" },
  shipping_address: { name: "Maya Chen", first_name: "Maya", last_name: "Chen" },
  line_items: [
    {
      id: 8801,
      admin_graphql_api_id: "gid://shopify/LineItem/8801",
      sku: "LAMP",
      title: "Desk lamp",
      quantity: 1,
      fulfillable_quantity: 1,
      fulfillment_status: null,
    },
  ],
};

describe("shopify hmac", () => {
  it("accepts a matching signature and rejects a tampered body", async () => {
    const secret = "rackline-demo-shopify-secret";
    const body = JSON.stringify(paidLampOrder);
    const header = await shopifyHmac(secret, body);
    expect(await verifyShopifyHmac(secret, body, header)).toBe(true);
    expect(await verifyShopifyHmac(secret, body + " ", header)).toBe(false);
    expect(await verifyShopifyHmac(secret, body, "aaaa")).toBe(false);
    expect(await verifyShopifyHmac(secret, body, undefined)).toBe(false);
  });
});

describe("shop domain", () => {
  it("normalizes admin paste variants", () => {
    expect(normalizeShopDomain("Northwind-Makers")).toBe("northwind-makers.myshopify.com");
    expect(normalizeShopDomain("https://Northwind-Makers.myshopify.com/admin")).toBe(
      "northwind-makers.myshopify.com",
    );
  });
});

describe("inbound mapping", () => {
  it("geocodes a Shopify shipping address onto the inbound ticket", () => {
    const mapped = mapRestOrder({
      ...paidLampOrder,
      shipping_address: {
        name: "Maya Chen",
        first_name: "Maya",
        last_name: "Chen",
        address1: "88 Harbor Ave",
        city: "Seattle",
        province_code: "WA",
        country_code: "US",
        zip: "98101",
      },
    });
    expect("skip" in mapped).toBe(false);
    if ("skip" in mapped) return;
    expect(mapped.shipToAddress).toContain("Seattle");
    expect(mapped.dest).toMatchObject({ shipToCity: "Seattle", shipToRegion: "WA", shipToCountry: "US" });
    expect(mapped.dest.shipToLat).toBeCloseTo(47.6, 1);
  });

  it("skips cancelled and already fulfilled orders", () => {
    expect(mapRestOrder({ ...paidLampOrder, cancelled_at: "2026-09-18T12:00:00Z" })).toEqual({
      skip: true,
      reason: "cancelled",
    });
    expect(mapRestOrder({ ...paidLampOrder, fulfillment_status: "fulfilled" })).toEqual({
      skip: true,
      reason: "already_fulfilled",
    });
  });

  it("drops fulfilled lines and synthesizes SKUs when Shopify omits them", () => {
    const mapped = mapRestOrder({
      ...paidLampOrder,
      line_items: [
        { id: 1, sku: "LAMP", quantity: 1, fulfillment_status: "fulfilled" },
        { id: 2, sku: null, title: "Gift wrap", quantity: 2, fulfillment_status: null },
      ],
    });
    expect("skip" in mapped).toBe(false);
    if ("skip" in mapped) return;
    expect(mapped.lines).toEqual([
      expect.objectContaining({ sku: "SHOPIFY-2", title: "Gift wrap", qty: 2 }),
    ]);
  });

  it("copies a line image onto the mapped SKU when present", () => {
    const mapped = mapRestOrder({
      ...paidLampOrder,
      line_items: [
        {
          ...paidLampOrder.line_items[0]!,
          image: { src: "https://cdn.shopify.com/lamp.jpg" },
        },
      ],
    });
    expect("skip" in mapped).toBe(false);
    if ("skip" in mapped) return;
    expect(mapped.lines[0]?.imageUrl).toBe("https://cdn.shopify.com/lamp.jpg");
  });

  it("maps an assigned fulfillment order, including FO line ids", () => {
    const mapped = mapFulfillmentOrder({
      id: "gid://shopify/FulfillmentOrder/55",
      status: "open",
      order: { id: "gid://shopify/Order/1004", name: "#1004" },
      destination: { firstName: "Maya", lastName: "Chen" },
      lineItems: {
        nodes: [
          {
            id: "gid://shopify/FulfillmentOrderLineItem/9",
            remainingQuantity: 1,
            sku: "LAMP",
            lineItem: { id: "gid://shopify/LineItem/8801", sku: "LAMP", title: "Desk lamp" },
          },
        ],
      },
    });
    expect(mapped).toEqual(
      expect.objectContaining({
        shopifyOrderId: "1004",
        customerName: "Maya Chen",
        lines: [
          expect.objectContaining({
            sku: "LAMP",
            qty: 1,
            shopifyFulfillmentLineItemId: "gid://shopify/FulfillmentOrderLineItem/9",
          }),
        ],
      }),
    );
  });

  it("attaches fulfillment order line ids onto a REST-mapped ticket by SKU", () => {
    const inbound = mapRestOrder(paidLampOrder);
    if ("skip" in inbound) throw new Error("expected map");
    const attached = applyFulfillmentOrderIds(inbound, {
      id: "gid://shopify/FulfillmentOrder/55",
      lineItems: {
        nodes: [
          {
            id: "gid://shopify/FulfillmentOrderLineItem/9",
            sku: "LAMP",
            remainingQuantity: 1,
            lineItem: { id: "gid://shopify/LineItem/8801", sku: "LAMP" },
          },
        ],
      },
    });
    expect(attached.lines[0]?.shopifyFulfillmentLineItemId).toBe(
      "gid://shopify/FulfillmentOrderLineItem/9",
    );
  });
});

describe("fulfill-back payload", () => {
  it("builds fulfillmentCreate input with tracking", () => {
    const inbound = mapRestOrder(paidLampOrder);
    if ("skip" in inbound) throw new Error("expected map");
    const demo = demoFulfillmentIds(inbound);
    const fulfillment = buildFulfillmentCreateInput({
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/demo-1004",
      lineItems: demo.lines.map((line) => ({
        id: line.shopifyFulfillmentLineItemId!,
        quantity: line.qty,
      })),
      tracking: { number: "1Z999", company: "UPS" },
      notifyCustomer: true,
    });
    expect(fulfillment).toEqual({
      notifyCustomer: true,
      trackingInfo: [{ number: "1Z999", company: "UPS" }],
      lineItemsByFulfillmentOrder: [
        {
          fulfillmentOrderId: "gid://shopify/FulfillmentOrder/demo-1004",
          fulfillmentOrderLineItems: [
            { id: "gid://shopify/FulfillmentOrderLineItem/demo-8801", quantity: 1 },
          ],
        },
      ],
    });
  });

  it("posts every labeled carton as trackingInfo", () => {
    expect(
      shopifyTrackingInfo({
        tracking: { number: "1ZFIRST", company: "UPS" },
        packages: [
          { trackingNumber: "1ZBOX1", trackingCompany: "UPS" },
          { trackingNumber: "1ZBOX2", trackingCompany: "UPS" },
        ],
      }),
    ).toEqual([
      { number: "1ZBOX1", company: "UPS" },
      { number: "1ZBOX2", company: "UPS" },
    ]);
    const fulfillment = buildFulfillmentCreateInput({
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/demo-1",
      lineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/demo-1", quantity: 2 }],
      tracking: { number: "1ZFIRST", company: "UPS" },
      packages: [
        { trackingNumber: "1ZBOX1", trackingCompany: "UPS" },
        { trackingNumber: "1ZBOX2", trackingCompany: "UPS" },
      ],
    });
    expect(fulfillment.trackingInfo).toEqual([
      { number: "1ZBOX1", company: "UPS" },
      { number: "1ZBOX2", company: "UPS" },
    ]);
  });

  it("builds one carton fulfillment with that box tracking and line items", () => {
    const lineItems = fulfillmentLineItemsForPackage(
      [{ id: "ol1", shopifyFulfillmentLineItemId: "gid://shopify/FulfillmentOrderLineItem/9" }],
      [{ orderLineId: "ol1", qty: 1 }],
    );
    expect(lineItems).toEqual([{ id: "gid://shopify/FulfillmentOrderLineItem/9", quantity: 1 }]);
    const fulfillment = buildFulfillmentCreateInput({
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/demo-1",
      lineItems,
      packages: [{ trackingNumber: "1ZBOX1", trackingCompany: "UPS" }],
    });
    expect(fulfillment.trackingInfo).toEqual([{ number: "1ZBOX1", company: "UPS" }]);
    expect(fulfillment.lineItemsByFulfillmentOrder[0]?.fulfillmentOrderLineItems).toEqual([
      { id: "gid://shopify/FulfillmentOrderLineItem/9", quantity: 1 },
    ]);
  });

  it("builds a webhook-shaped demo payload that maps back", () => {
    const payload = buildDemoOrderPayload({
      id: 4242,
      customerName: "Harbor Workshop",
      lines: [{ sku: "LAMP", title: "Desk lamp", qty: 2 }],
    });
    const mapped = mapRestOrder(payload);
    expect(mapped).toEqual(
      expect.objectContaining({
        shopifyOrderId: "4242",
        customerName: "Harbor Workshop",
        lines: [expect.objectContaining({ sku: "LAMP", qty: 2 })],
      }),
    );
  });
});

describe("sellable inventory payload", () => {
  it("asks for inventory and location scopes and sets available qty", () => {
    expect(REQUIRED_SCOPES).toEqual(
      expect.arrayContaining(["read_inventory", "write_inventory", "read_locations", "read_products"]),
    );
    expect(
      buildInventorySetQuantitiesInput({
        locationId: "gid://shopify/Location/1",
        quantities: [{ inventoryItemId: "gid://shopify/InventoryItem/9", quantity: 5 }],
      }),
    ).toEqual({
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [
        {
          inventoryItemId: "gid://shopify/InventoryItem/9",
          locationId: "gid://shopify/Location/1",
          quantity: 5,
        },
      ],
    });
  });
});
