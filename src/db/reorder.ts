import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import {
  buildReorderLines,
  majorityVendor,
  suggestedReorderQty,
  type LowStockRow,
  type ReorderLine,
} from "../domain/reorder";

const OPEN_PO_STATUSES = ["draft", "ordered", "receiving"] as const;

export type ReorderQueueRow = LowStockRow & {
  suggestedQty: number;
  coveredByOpenPo: boolean;
};

export type ReorderQueue = {
  lowStock: ReorderQueueRow[];
  coveredItemIds: string[];
  orgVendor: string | null;
  draftLines: ReorderLine[];
};

export async function loadReorderQueue(
  db: AppDb,
  organizationId: string,
  warehouseId?: string | null,
): Promise<ReorderQueue> {
  const onHandByItem = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      qty: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    )
    .groupBy(schema.inventoryBalances.itemId);

  const catalog = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      reorderPoint: schema.items.reorderPoint,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));

  const qtyByItem = new Map(onHandByItem.map((row) => [row.itemId, Number(row.qty)]));

  const vendorRows = await db
    .select({
      itemId: schema.purchaseLines.itemId,
      vendorName: schema.purchases.vendorName,
      createdAt: schema.purchases.createdAt,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(
      and(
        eq(schema.purchases.organizationId, organizationId),
        warehouseId ? eq(schema.purchases.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.purchases.createdAt));

  const lastVendorByItem = new Map<string, string>();
  for (const row of vendorRows) {
    const name = row.vendorName?.trim();
    if (!name || lastVendorByItem.has(row.itemId)) continue;
    lastVendorByItem.set(row.itemId, name);
  }

  const orgVendor = majorityVendor(
    vendorRows
      .map((row) => row.vendorName?.trim())
      .filter((name): name is string => Boolean(name))
      .map((vendorName) => ({
        itemId: "",
        sku: "",
        name: "",
        qty: 1,
        onHand: 0,
        reorderPoint: 0,
        vendorName,
      })),
    "",
  ) || null;

  const openPoLines = await db
    .select({ itemId: schema.purchaseLines.itemId })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(
      and(
        eq(schema.purchases.organizationId, organizationId),
        inArray(schema.purchases.status, [...OPEN_PO_STATUSES]),
        warehouseId ? eq(schema.purchases.warehouseId, warehouseId) : undefined,
      ),
    );
  const coveredItemIds = [...new Set(openPoLines.map((row) => row.itemId))];

  const below: LowStockRow[] = catalog
    .filter((item) => item.reorderPoint > 0 && (qtyByItem.get(item.id) ?? 0) <= item.reorderPoint)
    .map((item) => ({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      onHand: qtyByItem.get(item.id) ?? 0,
      reorderPoint: item.reorderPoint,
      lastVendorName: lastVendorByItem.get(item.id) ?? orgVendor,
    }));

  const draftLines = buildReorderLines(below, coveredItemIds, orgVendor);
  const covered = new Set(coveredItemIds);
  const lowStock: ReorderQueueRow[] = below.map((row) => ({
    ...row,
    suggestedQty: suggestedReorderQty(row.onHand, row.reorderPoint),
    coveredByOpenPo: covered.has(row.itemId),
  }));

  return { lowStock, coveredItemIds, orgVendor, draftLines };
}
