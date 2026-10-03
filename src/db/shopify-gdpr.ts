import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";

const REDACTED = "Redacted";

export function shopifyGdprTopic(topic: string): "data_request" | "customers_redact" | "shop_redact" | null {
  if (topic === "customers/data_request") return "data_request";
  if (topic === "customers/redact") return "customers_redact";
  if (topic === "shop/redact") return "shop_redact";
  return null;
}

export function shopifyGdprCustomer(payload: unknown): { email: string | null; orderIds: string[] } {
  if (!payload || typeof payload !== "object") return { email: null, orderIds: [] };
  const body = payload as { customer?: { email?: unknown }; orders_to_redact?: unknown };
  const email = typeof body.customer?.email === "string" ? body.customer.email.trim().toLowerCase() : null;
  const orderIds = Array.isArray(body.orders_to_redact) ? body.orders_to_redact.map((id) => String(id)) : [];
  return { email, orderIds };
}

const blankShip = {
  customerName: REDACTED,
  shipToAddress: null,
  shipToCity: null,
  shipToRegion: null,
  shipToLat: null,
  shipToLng: null,
};

/** Removes shopper details Shopify asks us to delete. The order number and stock movements stay. */
export async function redactShopifyCustomer(
  db: AppDb,
  organizationId: string,
  input: { email: string | null; orderIds: string[] },
): Promise<{ orders: number }> {
  const orderIds = [...new Set(input.orderIds.filter(Boolean))];
  let orders = 0;
  if (orderIds.length) {
    const updated = await db
      .update(schema.orders)
      .set(blankShip)
      .where(and(eq(schema.orders.organizationId, organizationId), inArray(schema.orders.shopifyOrderId, orderIds)))
      .returning({ id: schema.orders.id });
    orders += updated.length;
  }
  if (input.email) {
    const people = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(eq(schema.customers.organizationId, organizationId), sql`lower(trim(${schema.customers.email})) = ${input.email}`),
      );
    if (people.length) {
      await db
        .update(schema.customers)
        .set({ name: REDACTED, email: null, phone: null, shipToAddress: null, updatedAt: Date.now() })
        .where(inArray(schema.customers.id, people.map((row) => row.id)));
      const linked = await db
        .update(schema.orders)
        .set(blankShip)
        .where(and(eq(schema.orders.organizationId, organizationId), inArray(schema.orders.customerId, people.map((row) => row.id))))
        .returning({ id: schema.orders.id });
      orders += linked.length;
    }
  }
  return { orders };
}

/** 48 hours after uninstall, Shopify asks for the shop's data to go. The warehouse ledger stays. */
export async function redactShopifyShop(db: AppDb, organizationId: string, shopDomain: string): Promise<void> {
  await db
    .update(schema.orders)
    .set(blankShip)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.shopifyShopDomain, shopDomain)));
  await db
    .delete(schema.shopifyConnections)
    .where(and(eq(schema.shopifyConnections.organizationId, organizationId), eq(schema.shopifyConnections.shopDomain, shopDomain)));
}
