import { and, eq, gte, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { isRateKind, rateActivity, type ActivityLine, type ActivitySlice, type RateKind } from "../domain/billing";

const PERIOD_MS = 30 * 86_400_000;

type Slice = ActivitySlice & { clientId: string };

export type ActivityDraft = {
  clientId: string;
  clientCode: string;
  clientName: string;
  lines: ActivityLine[];
  amountCents: number;
};

function qtyOf(value: unknown): number {
  return Math.abs(Number(value) || 0);
}

export async function loadActivityDrafts(
  db: AppDb,
  organizationId: string,
  now = Date.now(),
): Promise<{ periodStart: number; periodEnd: number; drafts: ActivityDraft[] }> {
  const periodEnd = now;
  const periodStart = now - PERIOD_MS;
  const [clientRows, rateRows] = await Promise.all([
    db
      .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, organizationId)),
    db
      .select({
        clientId: schema.clientRates.clientId,
        kind: schema.clientRates.kind,
        unitCents: schema.clientRates.unitCents,
      })
      .from(schema.clientRates)
      .where(eq(schema.clientRates.organizationId, organizationId)),
  ]);
  const rates = new Map<string, Partial<Record<RateKind, number>>>();
  for (const row of rateRows) {
    if (!isRateKind(row.kind)) continue;
    const card = rates.get(row.clientId) ?? {};
    card[row.kind] = row.unitCents;
    rates.set(row.clientId, card);
  }

  const slices: Slice[] = [];

  const storage = await db
    .select({
      clientId: schema.clientBalances.clientId,
      qty: sql<number>`coalesce(sum(${schema.clientBalances.qty}), 0)`,
    })
    .from(schema.clientBalances)
    .where(eq(schema.clientBalances.organizationId, organizationId))
    .groupBy(schema.clientBalances.clientId);
  for (const row of storage) {
    slices.push({ clientId: row.clientId, kind: "storage", qty: qtyOf(row.qty) });
  }

  const picks = await db
    .select({
      clientId: schema.orders.clientId,
      refId: schema.orders.id,
      refNumber: schema.orders.number,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
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
    .groupBy(schema.orders.clientId, schema.orders.id, schema.orders.number);
  for (const row of picks) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "pick",
      qty: qtyOf(row.qty),
      refType: "order",
      refId: row.refId,
      refNumber: row.refNumber,
    });
  }

  const cartons = await db
    .select({
      clientId: schema.orders.clientId,
      refId: schema.orders.id,
      refNumber: schema.orders.number,
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
    .groupBy(schema.orders.clientId, schema.orders.id, schema.orders.number);
  for (const row of cartons) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "carton",
      qty: qtyOf(row.qty),
      refType: "order",
      refId: row.refId,
      refNumber: row.refNumber,
    });
  }

  const receives = await db
    .select({
      clientId: schema.inventoryMovements.clientId,
      refType: schema.inventoryMovements.refType,
      refId: schema.inventoryMovements.refId,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "receive"),
        isNotNull(schema.inventoryMovements.clientId),
        notInArray(schema.inventoryMovements.refType, ["return", "rma"]),
        gte(schema.inventoryMovements.createdAt, periodStart),
        lte(schema.inventoryMovements.createdAt, periodEnd),
      ),
    )
    .groupBy(schema.inventoryMovements.clientId, schema.inventoryMovements.refType, schema.inventoryMovements.refId);
  const receiveIds = {
    receipt: new Set<string>(),
    purchase: new Set<string>(),
    asn: new Set<string>(),
  };
  for (const row of receives) {
    if (row.refType === "receipt") receiveIds.receipt.add(row.refId);
    if (row.refType === "purchase") receiveIds.purchase.add(row.refId);
    if (row.refType === "asn") receiveIds.asn.add(row.refId);
  }
  const numbers = new Map<string, string>();
  async function remember(table: typeof schema.receipts | typeof schema.purchases | typeof schema.asns, ids: Set<string>) {
    const list = [...ids];
    if (list.length === 0) return;
    const rows = await db
      .select({ id: table.id, number: table.number })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), inArray(table.id, list)));
    for (const row of rows) numbers.set(row.id, row.number);
  }
  await remember(schema.receipts, receiveIds.receipt);
  await remember(schema.purchases, receiveIds.purchase);
  await remember(schema.asns, receiveIds.asn);
  for (const row of receives) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "receive",
      qty: qtyOf(row.qty),
      refType: row.refType,
      refId: row.refId,
      refNumber: numbers.get(row.refId),
    });
  }

  const kits = await db
    .select({
      clientId: schema.kitBuilds.clientId,
      refId: schema.kitBuilds.id,
      refNumber: schema.kitBuilds.number,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.kitBuilds, eq(schema.kitBuilds.id, schema.inventoryMovements.refId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "kit_produce"),
        eq(schema.inventoryMovements.refType, "kit"),
        isNotNull(schema.kitBuilds.clientId),
        gte(schema.inventoryMovements.createdAt, periodStart),
        lte(schema.inventoryMovements.createdAt, periodEnd),
      ),
    )
    .groupBy(schema.kitBuilds.clientId, schema.kitBuilds.id, schema.kitBuilds.number);
  for (const row of kits) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "kit",
      qty: qtyOf(row.qty),
      refType: "kit",
      refId: row.refId,
      refNumber: row.refNumber,
    });
  }

  const workOrders = await db
    .select({
      clientId: schema.workOrders.clientId,
      refId: schema.workOrders.id,
      refNumber: schema.workOrders.number,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.workOrders, eq(schema.workOrders.id, schema.inventoryMovements.refId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "wo_produce"),
        eq(schema.inventoryMovements.refType, "work_order"),
        isNotNull(schema.workOrders.clientId),
        gte(schema.inventoryMovements.createdAt, periodStart),
        lte(schema.inventoryMovements.createdAt, periodEnd),
      ),
    )
    .groupBy(schema.workOrders.clientId, schema.workOrders.id, schema.workOrders.number);
  for (const row of workOrders) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "work_order",
      qty: qtyOf(row.qty),
      refType: "work_order",
      refId: row.refId,
      refNumber: row.refNumber,
    });
  }

  const returns = await db
    .select({
      clientId: sql<string | null>`coalesce(${schema.rmas.clientId}, ${schema.orders.clientId})`,
      refId: schema.rmas.id,
      refNumber: schema.rmas.number,
      qty: sql<number>`coalesce(sum(abs(${schema.inventoryMovements.qty})), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.rmas, eq(schema.rmas.id, schema.inventoryMovements.refId))
    .leftJoin(schema.orders, eq(schema.orders.id, schema.rmas.orderId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.type, "receive"),
        inArray(schema.inventoryMovements.refType, ["return", "rma"]),
        gte(schema.inventoryMovements.createdAt, periodStart),
        lte(schema.inventoryMovements.createdAt, periodEnd),
      ),
    )
    .groupBy(
      sql`coalesce(${schema.rmas.clientId}, ${schema.orders.clientId})`,
      schema.rmas.id,
      schema.rmas.number,
    );
  for (const row of returns) {
    if (!row.clientId) continue;
    slices.push({
      clientId: row.clientId,
      kind: "rma",
      qty: qtyOf(row.qty),
      refType: "return",
      refId: row.refId,
      refNumber: row.refNumber,
    });
  }

  const byClient = new Map<string, ActivitySlice[]>();
  for (const slice of slices) {
    const list = byClient.get(slice.clientId) ?? [];
    list.push(slice);
    byClient.set(slice.clientId, list);
  }
  const known = new Map(clientRows.map((row) => [row.id, row]));
  const drafts: ActivityDraft[] = [];
  for (const [clientId, activity] of byClient) {
    const client = known.get(clientId);
    const card = rates.get(clientId);
    if (!client || !card) continue;
    const rated = rateActivity(activity, card);
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
