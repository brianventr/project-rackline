import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { clientRunwayDays } from "../domain/client-portal";
import { notFound } from "../lib/http";

const PERIOD_MS = 30 * 86_400_000;
const CLOSED = ["shipped", "cancelled"];

export async function loadClientPortal(db: AppDb, organizationId: string, clientId: string, now = Date.now()) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");

  const stock = await db
    .select({
      sku: schema.items.sku,
      itemName: schema.items.name,
      locationCode: schema.locations.code,
      qty: schema.clientBalances.qty,
    })
    .from(schema.clientBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.clientBalances.itemId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.clientBalances.locationId))
    .where(and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.clientBalances.clientId, clientId)))
    .orderBy(schema.items.sku, schema.locations.code);

  const onHandByItem = await db
    .select({
      itemId: schema.clientBalances.itemId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      qty: sql<number>`coalesce(sum(${schema.clientBalances.qty}), 0)`,
    })
    .from(schema.clientBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.clientBalances.itemId))
    .where(and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.clientBalances.clientId, clientId)))
    .groupBy(schema.clientBalances.itemId, schema.items.sku, schema.items.name);

  const shipped = await db
    .select({
      itemId: schema.inventoryMovements.itemId,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.inventoryMovements.refId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "ship"),
        eq(schema.inventoryMovements.refType, "order"),
        eq(schema.orders.clientId, clientId),
        gte(schema.inventoryMovements.createdAt, now - PERIOD_MS),
      ),
    )
    .groupBy(schema.inventoryMovements.itemId);
  const shippedByItem = new Map(shipped.map((row) => [row.itemId, Math.abs(Number(row.qty) || 0)]));

  const orders = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      status: schema.orders.status,
      source: schema.orders.source,
      customerName: schema.orders.customerName,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.clientId, clientId),
        notInArray(schema.orders.status, CLOSED),
      ),
    )
    .orderBy(schema.orders.number);

  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.organizationId, organizationId),
        eq(schema.invoices.clientId, clientId),
        eq(schema.invoices.status, "issued"),
      ),
    )
    .orderBy(schema.invoices.createdAt);

  return {
    client: { id: client.id, code: client.code, name: client.name },
    stock: stock.filter((row) => row.qty > 0),
    runway: onHandByItem
      .map((row) => ({
        sku: row.sku,
        itemName: row.itemName,
        onHand: Math.abs(Number(row.qty) || 0),
        shippedUnits: shippedByItem.get(row.itemId) ?? 0,
        days: clientRunwayDays(Math.abs(Number(row.qty) || 0), shippedByItem.get(row.itemId) ?? 0),
      }))
      .filter((row) => row.onHand > 0),
    orders,
    invoices: invoices.map((row) => ({
      id: row.id,
      number: row.number,
      amountCents: row.amountCents,
      issuedAt: row.issuedAt,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    })),
  };
}
