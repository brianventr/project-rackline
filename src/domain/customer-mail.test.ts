import { describe, expect, it } from "vitest";
import { customerMailProblems, customerMailResendPath } from "./exceptions/customer-mail";
import {
  customerMailDecision,
  customerMailEventForTracker,
  customerMailFrom,
  customerMailIdempotencyKey,
  DEFAULT_CUSTOMER_MAIL_POLICY,
  parseReplyTo,
  parseSenderName,
  renderCustomerMail,
  sampleCustomerMail,
  SKIP_OFF,
  SKIP_STORE,
  storeNotifiesCustomer,
  type CustomerMailModel,
} from "./customer-mail";

const model = (overrides: Partial<CustomerMailModel> = {}): CustomerMailModel => ({
  event: "shipped",
  shopName: "Northwind Makers",
  brandColor: "#1f6feb",
  logoUrl: "https://cdn.example.com/logo.png",
  orderNumber: "ORD-1004",
  parcels: [{ carrier: "USPS", service: "USPS Ground Advantage", trackingNumber: "9400111899223197428490" }],
  trackingUrl: "https://rackline.example/t/abcDEF1234567890abcd",
  items: [{ name: "Desk lamp", qty: 2 }],
  estimatedDelivery: "Oct 8, 2026",
  ...overrides,
});

describe("customer mail policy", () => {
  it("defaults to sending only when the store does not notify", () => {
    expect(DEFAULT_CUSTOMER_MAIL_POLICY).toBe("store");
    expect(customerMailDecision("store", false)).toEqual({ send: true });
    expect(customerMailDecision("store", true)).toEqual({ send: false, reason: SKIP_STORE });
    expect(customerMailDecision("always", true)).toEqual({ send: true });
    expect(customerMailDecision("never", false)).toEqual({ send: false, reason: SKIP_OFF });
  });

  it("treats live Shopify, WooCommerce, and Etsy post-backs as the store notifying", () => {
    expect(storeNotifiesCustomer({ source: "shopify", shopifyMode: "live" })).toBe(true);
    expect(storeNotifiesCustomer({ source: "shopify", shopifyMode: "demo" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "woocommerce", postBack: "live" })).toBe(true);
    expect(storeNotifiesCustomer({ source: "etsy", postBack: "live" })).toBe(true);
    expect(storeNotifiesCustomer({ source: "etsy", postBack: "manual" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "etsy", postBack: "live", channelSyncStatus: "manual" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "manual" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "faire" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "csv" })).toBe(false);
    expect(storeNotifiesCustomer({ source: "crowdfunding" })).toBe(false);
  });

  it("keys one row per order or return and event", () => {
    expect(customerMailIdempotencyKey({ orderId: "o1", event: "shipped" })).toBe("order:o1:shipped");
    expect(customerMailIdempotencyKey({ orderId: "o1", event: "delivered" })).toBe("order:o1:delivered");
    expect(customerMailIdempotencyKey({ rmaId: "r1", event: "return_label" })).toBe("rma:r1:return_label");
  });
});

describe("tracker email events", () => {
  it("emails out for delivery, delivered, and exceptions, not a plain in-transit scan", () => {
    expect(customerMailEventForTracker("out_for_delivery")).toBe("out_for_delivery");
    expect(customerMailEventForTracker("Out for delivery")).toBe("out_for_delivery");
    expect(customerMailEventForTracker("in_transit")).toBeNull();
    expect(customerMailEventForTracker("delivered")).toBe("delivered");
    expect(customerMailEventForTracker("return_to_sender")).toBe("delivery_exception");
    expect(customerMailEventForTracker("pre_transit")).toBeNull();
  });
});

describe("customer mail rendering", () => {
  it("includes the shop, brand, tracking page, and items, and leaves out prices and ids", () => {
    const rendered = renderCustomerMail(model());
    expect(rendered.subject).toBe("Your order ORD-1004 has shipped");
    expect(rendered.text).toContain("Northwind Makers");
    expect(rendered.text).toContain("USPS Ground Advantage");
    expect(rendered.text).toContain("9400111899223197428490");
    expect(rendered.text).toContain("https://rackline.example/t/abcDEF1234567890abcd");
    expect(rendered.text).toContain("Desk lamp × 2");
    expect(rendered.text).toContain("Oct 8, 2026");
    expect(rendered.html).toContain("#1f6feb");
    expect(rendered.html).toContain("https://cdn.example.com/logo.png");
    expect(rendered.html).toContain("style=");
    expect(rendered.html).not.toContain("$");
    expect(rendered.text).not.toContain("$");
    expect(rendered.html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(rendered.html).not.toContain("<script");
  });

  it("escapes the shop name and points a return label at /r/", () => {
    const rendered = renderCustomerMail(
      model({
        event: "return_label",
        shopName: "A & B <shop>",
        trackingUrl: "https://rackline.example/r/abcDEF1234567890abcd",
        estimatedDelivery: null,
      }),
    );
    expect(rendered.subject).toBe("Your return label from A & B <shop>");
    expect(rendered.html).toContain("A &amp; B &lt;shop&gt;");
    expect(rendered.html).not.toContain("<shop>");
    expect(rendered.text).toContain("https://rackline.example/r/abcDEF1234567890abcd");
    expect(rendered.text).not.toContain("Estimated delivery");
    expect(rendered.html).not.toContain("https://cdn.example.com/logo.png\" onerror");
  });

  it("omits a logo that is not https and a delivery date that is unknown", () => {
    const rendered = renderCustomerMail(model({ logoUrl: "/media/logo.png", estimatedDelivery: null, parcels: [] }));
    expect(rendered.html).not.toContain("<img");
    expect(rendered.text).not.toContain("Estimated delivery");
  });

  it("builds a sample the settings page can preview", () => {
    const rendered = renderCustomerMail(
      sampleCustomerMail({
        event: "delivered",
        shopName: "Northwind",
        brandColor: null,
        logoUrl: null,
        trackingUrl: "https://rackline.example/t/preview",
      }),
    );
    expect(rendered.subject).toContain("was delivered");
    expect(rendered.html).toContain("#111827");
    expect(rendered.text).toContain("Desk lamp");
  });
});

describe("customer mail envelope", () => {
  it("keeps MAIL_FROM as the address and puts the display name in front", () => {
    expect(customerMailFrom("floor@rackline.example", "Northwind")).toBe("Northwind <floor@rackline.example>");
    expect(customerMailFrom("Rackline <floor@rackline.example>", "Northwind")).toBe("Northwind <floor@rackline.example>");
    expect(customerMailFrom("floor@rackline.example", null)).toBe("floor@rackline.example");
  });

  it("accepts a reply-to address and a short sender name", () => {
    expect(parseReplyTo("  Owner@Shop.Example ")).toBe("owner@shop.example");
    expect(parseReplyTo("")).toBeNull();
    expect(() => parseReplyTo("not-an-email")).toThrow(/email/);
    expect(parseSenderName(" Northwind Makers ")).toBe("Northwind Makers");
    expect(() => parseSenderName("A <B>")).toThrow(/</);
  });
});

describe("failed customer emails in the inbox", () => {
  it("lists a failed send and points Resend at that order and event", () => {
    const [item] = customerMailProblems([
      {
        orderId: "o1",
        rmaId: null,
        event: "shipped",
        status: "failed",
        reason: "Mail HTTP 401",
        orderNumber: "ORD-1",
        rmaNumber: null,
        warehouseId: "wh1",
        updatedAt: 10,
      },
    ]);
    expect(item).toMatchObject({
      key: "order:o1:shipped",
      ownerOnly: true,
      action: { id: "resend-customer-email", label: "Resend" },
      link: "/outbound/orders/o1",
    });
    expect(item!.detail.startsWith("Mail HTTP 401")).toBe(true);
    expect(customerMailResendPath(item!.key)).toBe("/orders/o1/customer-emails/shipped/resend");
    expect(
      customerMailProblems([
        {
          orderId: "o1",
          rmaId: null,
          event: "shipped",
          status: "sent",
          reason: null,
          orderNumber: "ORD-1",
          rmaNumber: null,
          warehouseId: "wh1",
          updatedAt: 10,
        },
      ]),
    ).toEqual([]);
  });
});
