import { and, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import { newId } from "../lib/ids";
import {
  applyFulfillmentOrderIds,
  demoFulfillmentIds,
  demoFulfillmentOrderId,
  mapFulfillmentOrder,
  mapRestOrder,
  type MappedInboundOrder,
  type ShopifyRestOrder,
  type ShopifyFulfillmentOrderNode,
} from "./shopify";
import { createShopifyGraphqlClient, fetchOrderFulfillmentOrders } from "../lib/shopify-client";

export class ShopifyIngestError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "ShopifyIngestError";
  }
}

export type ShopifyConnectionRow = typeof schema.shopifyConnections.$inferSelect;

async function firstWarehouse(db: AppDb, organizationId: string) {
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId))
    .limit(1);
  if (!warehouse) {
    throw new ShopifyIngestError("Organization has no warehouse", 409);
  }
  return warehouse;
}

async function resolveItem(db: AppDb, organizationId: string, sku: string, title: string, now: number) {
  const [existing] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), sql`lower(${schema.items.sku}) = ${sku.toLowerCase()}`))
    .limit(1);
  if (existing) return existing;
  const item = {
    id: newId(),
    organizationId,
    sku,
    name: title,
    type: "finished" as const,
    barcode: sku,
    createdAt: now,
  };
  await db.insert(schema.items).values(item);
  return item;
}

export async function persistInboundOrder(
  db: AppDb,
  connection: ShopifyConnectionRow,
  inbound: MappedInboundOrder,
  options?: { fulfillmentOrderId?: string | null },
): Promise<{ orderId: string; created: boolean; number: string }> {
  const [existing] = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, connection.organizationId),
        eq(schema.orders.shopifyOrderId, inbound.shopifyOrderId),
      ),
    )
    .limit(1);
  if (existing) {
    return { orderId: existing.id, created: false, number: existing.number };
  }

  const warehouse = await firstWarehouse(db, connection.organizationId);
  const now = Date.now();
  const orderId = newId();
  const foId =
    options?.fulfillmentOrderId ||
    (connection.mode === "demo" ? demoFulfillmentOrderId(inbound.shopifyOrderId) : null);
  const lines = [];
  for (const line of inbound.lines) {
    const item = await resolveItem(db, connection.organizationId, line.sku, line.title, now);
    lines.push({
      id: newId(),
      orderId,
      itemId: item.id,
      qty: line.qty,
      shopifyLineItemId: line.shopifyLineItemId,
      shopifyFulfillmentLineItemId: line.shopifyFulfillmentLineItemId,
    });
  }

  await db.batch([
    db.insert(schema.orders).values({
      id: orderId,
      organizationId: connection.organizationId,
      warehouseId: warehouse.id,
      number: inbound.shopifyOrderName,
      customerName: inbound.customerName,
      status: "open",
      createdAt: now,
      source: "shopify",
      shopifyOrderId: inbound.shopifyOrderId,
      shopifyOrderGid: inbound.shopifyOrderGid,
      shopifyOrderName: inbound.shopifyOrderName,
      shopifyFulfillmentOrderId: foId,
      shopifySyncStatus: "inbound",
      shopifyShopDomain: connection.shopDomain,
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  return { orderId, created: true, number: inbound.shopifyOrderName };
}

export async function ingestRestOrder(
  db: AppDb,
  connection: ShopifyConnectionRow,
  payload: ShopifyRestOrder,
): Promise<{ skipped?: string; orderId?: string; created?: boolean; number?: string }> {
  const mapped = mapRestOrder(payload);
  if ("skip" in mapped) {
    return { skipped: mapped.reason };
  }

  let inbound = mapped;
  let foId: string | null = null;
  if (connection.mode === "demo" || !connection.accessToken) {
    inbound = demoFulfillmentIds(mapped);
    foId = demoFulfillmentOrderId(mapped.shopifyOrderId);
  } else {
    try {
      const client = createShopifyGraphqlClient({
        shopDomain: connection.shopDomain,
        accessToken: connection.accessToken,
        apiVersion: connection.apiVersion,
      });
      const nodes = await fetchOrderFulfillmentOrders(client, mapped.shopifyOrderGid);
      const open = nodes.find((node) => node.status !== "closed" && node.status !== "cancelled") ?? nodes[0];
      if (open) {
        inbound = applyFulfillmentOrderIds(mapped, open);
        foId = open.id;
      }
    } catch {
      inbound = mapped;
    }
  }

  return persistInboundOrder(db, connection, inbound, { fulfillmentOrderId: foId });
}

export async function ingestFulfillmentOrderNode(
  db: AppDb,
  connection: ShopifyConnectionRow,
  node: ShopifyFulfillmentOrderNode,
): Promise<{ skipped?: string; orderId?: string; created?: boolean; number?: string }> {
  const mapped = mapFulfillmentOrder(node);
  if ("skip" in mapped) return { skipped: mapped.reason };
  return persistInboundOrder(db, connection, mapped, { fulfillmentOrderId: node.id });
}

export async function recordWebhookReceipt(
  db: AppDb,
  input: { id: string; organizationId: string; topic: string; shopDomain: string },
): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.shopifyWebhookReceipts.id })
    .from(schema.shopifyWebhookReceipts)
    .where(eq(schema.shopifyWebhookReceipts.id, input.id))
    .limit(1);
  if (existing) return false;
  await db.insert(schema.shopifyWebhookReceipts).values({
    id: input.id,
    organizationId: input.organizationId,
    topic: input.topic,
    shopDomain: input.shopDomain,
    createdAt: Date.now(),
  });
  return true;
}

export async function cancelShopifyDraft(
  db: AppDb,
  organizationId: string,
  shopifyOrderId: string,
): Promise<boolean> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.shopifyOrderId, shopifyOrderId)))
    .limit(1);
  if (!order || (order.status !== "open" && order.status !== "draft" && order.status !== "picking")) return false;
  await db
    .update(schema.orders)
    .set({ status: "cancelled", shopifySyncStatus: "inbound" })
    .where(eq(schema.orders.id, order.id));
  return true;
}
