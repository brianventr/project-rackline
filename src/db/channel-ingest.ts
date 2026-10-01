import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { orderJobInput, syncDocumentJob } from "./jobs";
import { reserveOrderStock } from "./allocations";
import { scheduleOrderCreated } from "./outbound-webhooks";
import { ensureCustomer } from "./parties";
import { normalizeSku, type ChannelId, type ChannelOrder } from "../domain/channels/adapter";

export type ChannelConnectionRow = typeof schema.channelConnections.$inferSelect;

export type IngestResult =
  | { orderId: string; number: string; created: boolean; missingSkus: string[] }
  | { skipped: "unknown_skus"; missingSkus: string[] };

export async function channelWarehouseId(
  db: AppDb,
  organizationId: string,
  preferred?: string | null,
): Promise<string | null> {
  if (preferred) {
    const [row] = await db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, preferred), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1);
    if (row) return row.id;
  }
  const [row] = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId))
    .limit(1);
  return row?.id ?? null;
}

export async function skuIndex(db: AppDb, organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  return new Map(rows.map((row) => [normalizeSku(row.sku), row.id]));
}

async function existingOrder(db: AppDb, organizationId: string, source: string, externalId: string) {
  const [row] = await db
    .select({ id: schema.orders.id, number: schema.orders.number })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.source, source),
        eq(schema.orders.externalOrderId, externalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Lands one channel order as an open pick ticket. Re-delivered webhooks and re-pasted exports
 * return the existing order instead of a duplicate.
 */
export async function persistChannelOrder(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    channel: Exclude<ChannelId, "shopify">;
    order: ChannelOrder;
    skus: Map<string, string>;
    /** Live channels create unknown SKUs as finished goods (like Shopify); CSV reports them. */
    createMissingItems: boolean;
  },
): Promise<IngestResult> {
  const { organizationId, channel, order } = input;
  const found = await existingOrder(db, organizationId, channel, order.externalId);
  if (found) return { orderId: found.id, number: found.number, created: false, missingSkus: [] };

  const now = Date.now();
  const orderId = newId();
  const missing = new Set<string>();
  const newItems: (typeof schema.items.$inferInsert)[] = [];
  const lines: (typeof schema.orderLines.$inferInsert)[] = [];
  const reserveLines: { id: string; itemId: string; sku: string; qty: number }[] = [];
  for (const line of order.lines) {
    const key = normalizeSku(line.sku);
    let itemId = input.skus.get(key);
    if (!itemId && input.createMissingItems) {
      itemId = newId();
      newItems.push({ id: itemId, organizationId, sku: line.sku.trim(), name: line.title, type: "finished", barcode: line.sku.trim(), createdAt: now });
      input.skus.set(key, itemId);
    }
    if (!itemId) {
      missing.add(line.sku);
      continue;
    }
    const lineId = newId();
    lines.push({ id: lineId, orderId, itemId, qty: line.qty, qtyPicked: 0 });
    reserveLines.push({ id: lineId, itemId, sku: line.sku, qty: line.qty });
  }
  if (lines.length === 0) return { skipped: "unknown_skus", missingSkus: [...missing] };

  const customer = await ensureCustomer(db, organizationId, {
    name: order.customerName,
    email: order.customerEmail,
    address: order.shipToAddress,
    channelRef: order.customerRef ? { channel, ref: order.customerRef } : null,
  });
  const row = {
    id: orderId,
    organizationId,
    warehouseId: input.warehouseId,
    number: order.externalName,
    customerName: order.customerName,
    customerId: customer.id,
    status: "open",
    createdAt: now,
    source: channel,
    externalOrderId: order.externalId,
    channelSyncStatus: "inbound",
    shipToAddress: order.shipToAddress,
    ...order.dest,
  };
  try {
    await db.batch([
      db.insert(schema.orders).values(row),
      ...newItems.map((item) => db.insert(schema.items).values(item)),
      ...lines.map((line) => db.insert(schema.orderLines).values(line)),
    ]);
  } catch (err) {
    const raced = await existingOrder(db, organizationId, channel, order.externalId);
    if (raced) return { orderId: raced.id, number: raced.number, created: false, missingSkus: [] };
    throw err;
  }
  await syncDocumentJob(db, orderJobInput(row));
  await reserveOrderStock(db, {
    organizationId,
    warehouseId: input.warehouseId,
    orderId,
    clientId: null,
    lines: reserveLines,
  });
  scheduleOrderCreated(db, organizationId, {
    number: row.number,
    status: row.status,
    city: row.shipToCity,
    lines: reserveLines.map((line) => ({ sku: line.sku, qty: line.qty })),
  });
  return { orderId, number: row.number, created: true, missingSkus: [...missing] };
}
