import { describe, expect, it } from "vitest";
import { clientPortalBody } from "./client-portal";

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

describe("clientPortalBody", () => {
  it("shows one client's stock, open orders, shipments, and invoices", () => {
    const body = clientPortalBody({
      organizationName: "Northwind",
      clientCode: "ACME",
      clientName: "Acme Retail",
      stock: [
        { sku: "LAMP", name: "Lamp", qty: 4 },
        { sku: "CORD", name: "Cord", qty: 0 },
      ],
      orders: [
        { number: "ORD-1", status: "open", shipToCity: "Portland" },
        { number: "ORD-2", status: "shipped", shipToCity: "Seattle" },
        { number: "ORD-3", status: "cancelled", shipToCity: "Austin" },
      ],
      shipments: [
        { orderNumber: "ORD-2", carrier: "UPS", trackingNumber: "1Z999", status: "in_transit" },
      ],
      invoices: [
        {
          number: "INV-1",
          amountCents: 100,
          status: "draft",
          periodStart: 1,
          periodEnd: 2,
          linesJson: JSON.stringify([
            { kind: "pick", label: "Picked units", qty: 4, unitCents: 25, amountCents: 100, clientId: "secret" },
          ]),
        },
      ],
    });

    expect(body.client).toEqual({ code: "ACME", name: "Acme Retail" });
    expect(body.stock).toEqual([{ sku: "LAMP", name: "Lamp", qty: 4 }]);
    expect(body.orders).toEqual([{ number: "ORD-1", status: "open", city: "Portland" }]);
    expect(body.shipments).toEqual([
      { orderNumber: "ORD-2", carrier: "UPS", trackingNumber: "1Z999", status: "in_transit" },
    ]);
    expect(body.invoices[0]?.lines).toEqual([
      { kind: "pick", label: "Picked units", qty: 4, unitCents: 25, amountCents: 100 },
    ]);
    const keys = keysOf(body);
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("clientId");
    expect(keys).not.toContain("organizationId");
    expect(keys).not.toContain("shipToAddress");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
