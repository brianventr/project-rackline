import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { applyHoldsToOnHand, HeldStockError, isHoldRestrictedType, matchingHoldForMove, type OpenHold } from "../domain/holds";
import type { MovementDraft } from "../domain/inventory";

export async function loadOpenHolds(
  db: AppDb,
  organizationId: string,
  warehouseId?: string,
): Promise<OpenHold[]> {
  const rows = await db
    .select({
      id: schema.inventoryHolds.id,
      number: schema.inventoryHolds.number,
      reason: schema.inventoryHolds.reason,
      locationId: schema.inventoryHolds.locationId,
      locationCode: schema.locations.code,
      itemId: schema.inventoryHolds.itemId,
      sku: schema.items.sku,
      lotCode: schema.inventoryHolds.lotCode,
      serialCode: schema.inventoryHolds.serialCode,
      warehouseId: schema.inventoryHolds.warehouseId,
    })
    .from(schema.inventoryHolds)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryHolds.locationId))
    .leftJoin(schema.items, eq(schema.items.id, schema.inventoryHolds.itemId))
    .where(
      and(
        eq(schema.inventoryHolds.organizationId, organizationId),
        eq(schema.inventoryHolds.status, "open"),
        warehouseId ? eq(schema.inventoryHolds.warehouseId, warehouseId) : undefined,
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    reason: row.reason,
    locationId: row.locationId,
    locationCode: row.locationCode,
    itemId: row.itemId,
    sku: row.sku,
    lotCode: row.lotCode,
    serialCode: row.serialCode,
  }));
}

export async function loadHeldLotQuantities(
  db: AppDb,
  organizationId: string,
  holds: OpenHold[],
): Promise<{ locationId: string; itemId: string; lotCode: string; qty: number }[]> {
  const lotHolds = holds.filter((hold): hold is OpenHold & { itemId: string; lotCode: string } =>
    Boolean(hold.itemId && hold.lotCode),
  );
  if (lotHolds.length === 0) return [];
  const locationIds = [...new Set(lotHolds.map((hold) => hold.locationId))];
  const itemIds = [...new Set(lotHolds.map((hold) => hold.itemId))];
  const rows = await db
    .select({
      locationId: schema.lotBalances.locationId,
      itemId: schema.lotBalances.itemId,
      lotCode: schema.lotBalances.lotCode,
      qty: schema.lotBalances.qty,
    })
    .from(schema.lotBalances)
    .where(
      and(
        eq(schema.lotBalances.organizationId, organizationId),
        inArray(schema.lotBalances.locationId, locationIds),
        inArray(schema.lotBalances.itemId, itemIds),
      ),
    );
  const wanted = new Set(lotHolds.map((hold) => `${hold.locationId}:${hold.itemId}:${hold.lotCode}`));
  return rows.filter((row) => wanted.has(`${row.locationId}:${row.itemId}:${row.lotCode}`));
}

export async function availableOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  db: AppDb,
  organizationId: string,
  rows: T[],
  warehouseId?: string,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const holds = await loadOpenHolds(db, organizationId, warehouseId);
  if (holds.length === 0) return rows;
  const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
  return applyHoldsToOnHand(rows, holds, lotQtys);
}

export function assertOutboundNotHeld(movements: MovementDraft[], holds: OpenHold[]): void {
  if (holds.length === 0) return;
  for (const movement of movements) {
    if (!isHoldRestrictedType(movement.type) || !movement.fromLocationId) continue;
    const hit = matchingHoldForMove(holds, movement.fromLocationId, movement.itemId, movement.lotCode);
    if (!hit) continue;
    throw new HeldStockError(hit.sku ?? movement.itemId, hit.locationCode, hit.number, hit.reason);
  }
}
