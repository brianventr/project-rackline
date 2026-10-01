import { describe, expect, it } from "vitest";
import { webhookProblems, webhookResendPath } from "./exceptions/webhooks";
import {
  apiKeyPrefix,
  newApiSecret,
  orderCreatedPayload,
  orderShippedPayload,
  parseWebhookUrl,
  serializeWebhookPayload,
  signWebhookBody,
  stockChangedPayload,
  verifyWebhookSignature,
} from "./webhooks";

describe("webhook signatures", () => {
  it("matches the HMAC a receiver computes over the raw body", async () => {
    const secret = "key";
    const body = "The quick brown fox jumps over the lazy dog";
    const header = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
    expect(await signWebhookBody(secret, body)).toBe(header);
    expect(await verifyWebhookSignature(secret, body, header)).toBe(true);
    const flipped = `${header[0] === "a" ? "b" : "a"}${header.slice(1)}`;
    expect(await verifyWebhookSignature(secret, body, flipped)).toBe(false);
    expect(await verifyWebhookSignature(secret, `${body} `, header)).toBe(false);

    const payload = orderCreatedPayload({
      number: "ORD-1",
      status: "open",
      city: "Portland",
      lines: [{ sku: "LAMP", qty: 2 }],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    const raw = serializeWebhookPayload(payload);
    expect(await verifyWebhookSignature(secret, raw, await signWebhookBody(secret, raw))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('"id"');
  });

  it("ships and stock events name the order or the SKU", () => {
    const shipped = orderShippedPayload({
      number: "ORD-9",
      status: "shipped",
      carrier: "UPS",
      trackingNumber: "1Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    const stock = stockChangedPayload({
      changes: [{ sku: "LAMP", qty: -1, type: "pick" }],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(shipped.order).toEqual({ number: "ORD-9", status: "shipped", carrier: "UPS", trackingNumber: "1Z" });
    expect(stock.changes).toEqual([{ sku: "LAMP", qty: -1, type: "pick" }]);
  });

  it("mints an unguessable key prefix and allows https or localhost", () => {
    const secret = newApiSecret();
    expect(secret).toMatch(/^rk_live_[A-Za-z0-9_-]{32}$/);
    expect(apiKeyPrefix(secret)).toBe(secret.slice(0, 12));
    expect(parseWebhookUrl("https://example.com/hooks")).toBe("https://example.com/hooks");
    expect(parseWebhookUrl("http://127.0.0.1:9/hook")).toContain("127.0.0.1:9");
    expect(() => parseWebhookUrl("http://example.com/hook")).toThrow(/https/);
  });
});

describe("webhookProblems", () => {
  it("offers Send again for a failed delivery", () => {
    const [item] = webhookProblems([
      {
        id: "del-1",
        event: "order.shipped",
        url: "http://127.0.0.1:9/hook",
        error: "fetch failed",
        responseCode: null,
        createdAt: 10,
      },
    ]);
    expect(item).toMatchObject({
      source: "webhooks",
      key: "del-1",
      warehouseId: null,
      ownerOnly: true,
      action: { id: "resend-webhook", label: "Send again" },
    });
    expect(webhookResendPath(item!.key)).toBe("/integrations/webhooks/deliveries/del-1/send");
  });
});
