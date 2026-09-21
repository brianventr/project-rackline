import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { rateActivity, type ActivityLine } from "../domain/billing";

const PERIOD_MS = 30 * 86_400_000;

type Bucket = { storagePieces: number; pickedUnits: number; shippedCartons: number };

export type ActivityDraft = {
  clientId: string;
  clientCode: string;
  clientName: string;
  lines: ActivityLine[];
  amountCents: number;
};

export async function loadActivityDrafts(
  db: AppDb,
  organizationId: string,
  now = Date.now(),
): Promise<{ periodStart: number; periodEnd: number; drafts: ActivityDraft[] }> {
  const periodEnd = now;
  const periodStart = now - PERIOD_MS;
  const clientRows = await db
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId));
  const buckets = new Map<string, Bucket>();
  function bucket(clientId: string): Bucket {
    const existing = buckets.get(clientId);
    if (existing) return existing;
    const created: Bucket = { storagePieces: 0, pickedUnits: 0, shippedCartons: 0 };
    buckets.set(clientId, created);
    return created;
  }

  const storage = await db
    .select({
      clientId: schema.clientBalances.clientId,
      qty: sql<number>`coalesce(sum(${schema.clientBalances.qty}), 0)`,
    })
    .from(schema.clientBalances)
    .where(eq(schema.clientBalances.organizationId, organizationId))
    .groupBy(schema.clientBalances.clientId);
  for (const row of storage) bucket(row.clientId).storagePieces = Math.abs(Number(row.qty) || 0);

  const picks = await db
    .select({
      clientId: schema.orders.clientId,
      qty: sql<number>`coalesce(sum(${schema.inventoryMovements.qty}), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.orders,
      and(eq(schema.orders.id, schema.inventoryMovements.refId), eq(schema.orders.organizationId, organizationId)),
    )
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "pick"),
        eq(schema.inventoryMovements.refType, "order"),
        gte(schema.inventoryMovements.createdAt, periodStart),
        lte(schema.inventoryMovements.createdAt, periodEnd),
        isNotNull(schema.orders.clientId),
      ),
    )
    .groupBy(schema.orders.clientId);
  for (const row of picks) {
    if (!row.clientId) continue;
    bucket(row.clientId).pickedUnits = Math.abs(Number(row.qty) || 0);
  }

  const cartons = await db
    .select({
      clientId: schema.orders.clientId,
      qty: sql<number>`count(*)`,
    })
    .from(schema.orderPackages)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderPackages.orderId))
    .where(
      and(
        eq(schema.orderPackages.organizationId, organizationId),
        gte(schema.orderPackages.shippedAt, periodStart),
        lte(schema.orderPackages.shippedAt, periodEnd),
        isNotNull(schema.orders.clientId),
      ),
    )
    .groupBy(schema.orders.clientId);
  for (const row of cartons) {
    if (!row.clientId) continue;
    bucket(row.clientId).shippedCartons = Math.abs(Number(row.qty) || 0);
  }

  const known = new Map(clientRows.map((row) => [row.id, row]));
  const drafts: ActivityDraft[] = [];
  for (const [clientId, activity] of buckets) {
    const client = known.get(clientId);
    if (!client) continue;
    const rated = rateActivity(activity);
    if (!rated) continue;
    drafts.push({
      clientId,
      clientCode: client.code,
      clientName: client.name,
      lines: rated.lines,
      amountCents: rated.amountCents,
    });
  }
  return { periodStart, periodEnd, drafts };
}
