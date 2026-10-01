import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { applyOpenQcToOnHand } from "../domain/qc-receive";

export type ReceiptQcView = {
  id: string;
  receiptLineId: string;
  itemId: string;
  sku: string;
  itemName: string;
  locationId: string;
  qty: number;
  status: string;
  photoUrl: string | null;
  holdId: string | null;
};

export type QcReservation = { locationId: string; itemId: string; qty: number };

export async function loadOpenQcReservations(db: AppDb, organizationId: string): Promise<QcReservation[]> {
  const rows = await db
    .select({
      locationId: schema.receiptQcSamples.locationId,
      itemId: schema.receiptQcSamples.itemId,
      qty: schema.receiptQcSamples.qty,
    })
    .from(schema.receiptQcSamples)
    .where(and(eq(schema.receiptQcSamples.organizationId, organizationId), eq(schema.receiptQcSamples.status, "open")));
  return rows;
}

export async function withOpenQc<T extends { locationId: string; itemId: string; qty: number }>(
  db: AppDb,
  organizationId: string,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const open = await loadOpenQcReservations(db, organizationId);
  return applyOpenQcToOnHand(rows, open);
}

export async function loadReceiptQc(db: AppDb, organizationId: string, receiptId: string): Promise<ReceiptQcView[]> {
  return db
    .select({
      id: schema.receiptQcSamples.id,
      receiptLineId: schema.receiptQcSamples.receiptLineId,
      itemId: schema.receiptQcSamples.itemId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      locationId: schema.receiptQcSamples.locationId,
      qty: schema.receiptQcSamples.qty,
      status: schema.receiptQcSamples.status,
      photoUrl: schema.receiptQcSamples.photoUrl,
      holdId: schema.receiptQcSamples.holdId,
    })
    .from(schema.receiptQcSamples)
    .innerJoin(schema.items, eq(schema.items.id, schema.receiptQcSamples.itemId))
    .where(and(eq(schema.receiptQcSamples.organizationId, organizationId), eq(schema.receiptQcSamples.receiptId, receiptId)));
}

export async function openQcCountByReceipt(db: AppDb, organizationId: string, receiptIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (receiptIds.length === 0) return counts;
  const rows = await db
    .select({
      receiptId: schema.receiptQcSamples.receiptId,
      qty: schema.receiptQcSamples.qty,
    })
    .from(schema.receiptQcSamples)
    .where(
      and(
        eq(schema.receiptQcSamples.organizationId, organizationId),
        eq(schema.receiptQcSamples.status, "open"),
        inArray(schema.receiptQcSamples.receiptId, receiptIds),
      ),
    );
  for (const row of rows) counts.set(row.receiptId, (counts.get(row.receiptId) ?? 0) + row.qty);
  return counts;
}
