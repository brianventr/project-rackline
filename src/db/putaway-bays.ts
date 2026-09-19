import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { baysForItem, type PutawayBay } from "../domain/directed-putaway";

export async function loadPutawayBaysByItem(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  itemIds: string[],
): Promise<Map<string, PutawayBay[]>> {
  const byItem = new Map<string, PutawayBay[]>();
  if (itemIds.length === 0) return byItem;

  const locations = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      type: schema.locations.type,
      slotRole: schema.locations.slotRole,
      aisle: schema.locations.aisle,
      warehouseId: schema.locations.warehouseId,
    })
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId)));

  const onHand = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .where(
      and(eq(schema.inventoryBalances.organizationId, organizationId), inArray(schema.inventoryBalances.itemId, itemIds)),
    );

  for (const itemId of itemIds) {
    byItem.set(itemId, baysForItem(locations, onHand, itemId));
  }
  return byItem;
}
