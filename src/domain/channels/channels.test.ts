import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  canRetryPostBack,
  carrierNameForChannel,
  channelHealth,
  channelOrder,
  manualPostBackNote,
  markShippedIn,
  markShippedReminder,
  postBackRoute,
  postsTrackingBack,
} from "./adapter";
import {
  isWooPing,
  mapWooOrder,
  normalizeWooStoreUrl,
  signWooBody,
  verifyWooSignature,
  wooTrackingNote,
} from "./woocommerce";
import {
  etsyApiKeyHeader,
  etsyAuthorizeUrl,
  etsyShipmentBody,
  etsyTokenFresh,
  etsyUserIdFromToken,
  mapEtsyReceipt,
  pkceChallenge,
} from "./etsy";
import { mapShopifyOrder } from "./shopify";
import { csvChannelOrders, parseChannelCsv } from "../channel-import";

describe("channel registry", () => {
  it("leads Garage with storefronts and Manufacturer with wholesale", () => {
    expect(channelOrder("garage")[1]).toBe("etsy");
    expect(channelOrder("warehouse")[1]).toBe("faire");
    expect(channelOrder("garage").sort()).toEqual(Object.keys(CHANNELS).sort());
  });

  it("only WooCommerce and Etsy post tracking through the shared path", () => {
    expect(postsTrackingBack("woocommerce")).toBe(true);
    expect(postsTrackingBack("etsy")).toBe(true);
    expect(postsTrackingBack("shopify")).toBe(false);
    expect(postsTrackingBack("faire")).toBe(false);
  });

  it("reports health from the connection row", () => {
    const woo = CHANNELS.woocommerce;
    const base = { status: "active", mode: "live", lastSyncAt: 1, lastSyncError: null };
    expect(channelHealth(woo, null)).toBe("disconnected");
    expect(channelHealth(woo, base)).toBe("live");
    expect(channelHealth(woo, { ...base, lastSyncError: "401" })).toBe("error");
    expect(channelHealth(woo, { ...base, mode: "demo" })).toBe("demo");
    expect(channelHealth(CHANNELS.faire, { ...base, mode: "csv" })).toBe("csv");
    expect(channelHealth(woo, { ...base, status: "paused" })).toBe("paused");
  });

  it("routes tracking by how the channel is connected", () => {
    expect(postBackRoute({ status: "active", mode: "live" })).toBe("live");
    expect(postBackRoute({ status: "paused", mode: "live" })).toBe("live");
    expect(postBackRoute({ status: "active", mode: "demo" })).toBe("demo");
    expect(postBackRoute({ status: "active", mode: "csv" })).toBe("manual");
    expect(postBackRoute({ status: "disconnected", mode: "csv" })).toBe("not_connected");
    expect(postBackRoute(null)).toBe("not_connected");
  });

  it("offers a retry only for a failed post-back, never a manual one", () => {
    const shipped = { source: "etsy", status: "shipped" };
    expect(canRetryPostBack({ ...shipped, channelSyncStatus: "failed" })).toBe(true);
    expect(canRetryPostBack({ ...shipped, channelSyncStatus: "manual" })).toBe(false);
    expect(canRetryPostBack({ ...shipped, channelSyncStatus: "fulfilled" })).toBe(false);
    expect(canRetryPostBack({ ...shipped, status: "packed", channelSyncStatus: "failed" })).toBe(false);
    expect(canRetryPostBack({ ...shipped, source: "faire", channelSyncStatus: "failed" })).toBe(false);
  });

  it("tells the owner to mark manual orders shipped in the channel", () => {
    expect(manualPostBackNote("etsy")).toBe("Etsy has no live connection, so tracking does not post back. Mark it shipped in Etsy.");
    expect(markShippedIn("faire")).toBe("Mark it shipped in Faire.");
    expect(markShippedReminder([])).toBeNull();
    expect(markShippedReminder([{ number: "ORD-1", source: "etsy" }])).toBe("Mark ORD-1 shipped in Etsy.");
    expect(
      markShippedReminder([
        { number: "ORD-1", source: "etsy" },
        { number: "ORD-2", source: "etsy" },
        { number: "ORD-3", source: "woocommerce" },
      ]),
    ).toBe("Mark 2 orders shipped in Etsy. Mark ORD-3 shipped in WooCommerce.");
  });

  it("maps carrier names channels recognize", () => {
    expect(carrierNameForChannel("USPS")).toBe("usps");
    expect(carrierNameForChannel("UPS")).toBe("ups");
    expect(carrierNameForChannel("FedEx Ground")).toBe("fedex");
    expect(carrierNameForChannel("Rackline Ground")).toBe("other");
  });
});

describe("WooCommerce", () => {
  const order = {
    id: 812,
    number: "1044",
    status: "processing",
    shipping: { first_name: "Rosa", last_name: "Diaz", address_1: "215 Water St", city: "Brooklyn", state: "NY", postcode: "11201", country: "US" },
    line_items: [
      { id: 1, name: "Walnut tray", sku: "TRAY-W", quantity: 2 },
      { id: 2, name: "Gift wrap", sku: "", product_id: 55, quantity: 1 },
      { id: 3, name: "Zero", sku: "Z", quantity: 0 },
    ],
  };

  it("maps a processing order to a pick ticket", () => {
    const mapped = mapWooOrder(order);
    if ("skip" in mapped) throw new Error("skipped");
    expect(mapped.externalId).toBe("812");
    expect(mapped.externalName).toBe("#1044");
    expect(mapped.customerName).toBe("Rosa Diaz");
    expect(mapped.lines).toEqual([
      { sku: "TRAY-W", title: "Walnut tray", qty: 2, externalLineId: "1" },
      { sku: "WOO-55", title: "Gift wrap", qty: 1, externalLineId: "2" },
    ]);
    expect(mapped.shipToAddress).toContain("Brooklyn");
    expect(mapped.dest.shipToCountry).toBe("US");
  });

  it("skips orders that are not paid-and-unshipped", () => {
    expect(mapWooOrder({ ...order, status: "pending" })).toEqual({ skip: true, reason: "pending" });
    expect(mapWooOrder({ ...order, status: "completed" })).toEqual({ skip: true, reason: "completed" });
    expect(mapWooOrder({ ...order, line_items: [] })).toEqual({ skip: true, reason: "no_fulfillable_lines" });
  });

  it("verifies webhook signatures and recognizes pings", async () => {
    const body = JSON.stringify(order);
    const sig = await signWooBody("hook-secret", body);
    expect(await verifyWooSignature("hook-secret", body, sig)).toBe(true);
    expect(await verifyWooSignature("other", body, sig)).toBe(false);
    expect(await verifyWooSignature("hook-secret", body, undefined)).toBe(false);
    expect(isWooPing("webhook_id=12", "application/x-www-form-urlencoded")).toBe(true);
    expect(isWooPing(body, "application/json")).toBe(false);
  });

  it("normalizes store URLs and refuses plain http", () => {
    expect(normalizeWooStoreUrl("shop.example.com/")).toBe("https://shop.example.com");
    expect(normalizeWooStoreUrl("https://example.com/store/")).toBe("https://example.com/store");
    expect(() => normalizeWooStoreUrl("http://shop.example.com")).toThrow(/https/);
  });

  it("writes a customer-visible tracking note", () => {
    expect(wooTrackingNote({ trackingNumber: "9400", company: "USPS", url: null })).toEqual({
      note: "Shipped via USPS tracking 9400.",
      customer_note: true,
    });
  });
});

describe("Etsy", () => {
  const receipt = {
    receipt_id: 3100000123,
    name: "Jordan Lee",
    first_line: "88 Alder Ave",
    city: "Portland",
    state: "OR",
    zip: "97205",
    country_iso: "US",
    is_paid: true,
    is_shipped: false,
    transactions: [
      { transaction_id: 9, title: "Mug", quantity: 1, sku: "MUG-1" },
      { transaction_id: 10, title: "No sku", quantity: 1, sku: null, listing_id: 777 },
    ],
  };

  it("maps a paid, unshipped receipt", () => {
    const mapped = mapEtsyReceipt(receipt);
    if ("skip" in mapped) throw new Error("skipped");
    expect(mapped.externalId).toBe("3100000123");
    expect(mapped.customerName).toBe("Jordan Lee");
    expect(mapped.lines.map((l) => l.sku)).toEqual(["MUG-1", "ETSY-777"]);
    expect(mapped.dest.shipToRegion).toBe("OR");
  });

  it("skips unpaid, shipped, and cancelled receipts", () => {
    expect(mapEtsyReceipt({ ...receipt, is_paid: false })).toEqual({ skip: true, reason: "unpaid" });
    expect(mapEtsyReceipt({ ...receipt, is_shipped: true })).toEqual({ skip: true, reason: "already_shipped" });
    expect(mapEtsyReceipt({ ...receipt, status: "Canceled" })).toEqual({ skip: true, reason: "cancelled" });
  });

  it("builds a PKCE authorize URL", async () => {
    const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const url = new URL(etsyAuthorizeUrl({ clientId: "key", redirectUri: "https://r.example/cb", state: "s", challenge }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("transactions_w");
  });

  it("reads the user id off the token and builds the key header", () => {
    expect(etsyUserIdFromToken("12345.abcdef")).toBe("12345");
    expect(etsyUserIdFromToken("abcdef")).toBeNull();
    expect(etsyApiKeyHeader("key", "shh")).toBe("key:shh");
    expect(etsyApiKeyHeader("key")).toBe("key");
  });

  it("posts tracking with a recognized carrier name", () => {
    const body = etsyShipmentBody({ trackingNumber: "1Z999", company: "UPS" });
    expect(body.get("tracking_code")).toBe("1Z999");
    expect(body.get("carrier_name")).toBe("ups");
  });

  it("refreshes tokens a minute before expiry", () => {
    expect(etsyTokenFresh(120_000, 0)).toBe(true);
    expect(etsyTokenFresh(30_000, 0)).toBe(false);
    expect(etsyTokenFresh(null, 0)).toBe(false);
  });
});

describe("normalized orders from Shopify and CSV", () => {
  it("wraps the Shopify mapper", () => {
    const mapped = mapShopifyOrder({
      id: 5,
      name: "#1001",
      line_items: [{ id: 7, sku: "LAMP", title: "Lamp", quantity: 1 }],
    });
    if ("skip" in mapped) throw new Error("skipped");
    expect(mapped.externalId).toBe("5");
    expect(mapped.lines[0]).toMatchObject({ sku: "LAMP", qty: 1, externalLineId: "7" });
  });

  it("groups CSV rows into one order per id and sums repeated SKUs", () => {
    const parsed = parseChannelCsv("etsy", "Order ID,Buyer,SKU,Quantity\n1001,Ada,LAMP,1\n1001,Ada,LAMP,2\n1002,Bo,MUG,1");
    const orders = csvChannelOrders("etsy", parsed.rows);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ externalId: "1001", externalName: "Etsy 1001", customerName: "Ada" });
    expect(orders[0]!.lines).toEqual([{ sku: "LAMP", title: "LAMP", qty: 3, externalLineId: null }]);
  });
});
