import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { baysForItem, type PutawayBay } from "../domain/directed-putaway";
import { capacityOf, NO_MEASURE, roomFor, type BinCapacity } from "../domain/capacity";
import { loadBinFill, loadItemMeasures } from "./capacity";

export async function loadPutawayBaysByItem(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  itemIds: string[],
): Promise<Map<string, PutawayBay[]>> {
  const byItem = new Map<string, PutawayBay[]>();
  if (itemIds.length === 0) return byItem;

  const rows = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      type: schema.locations.type,
      slotRole: schema.locations.slotRole,
      aisle: schema.locations.aisle,
      warehouseId: schema.locations.warehouseId,
      maxQty: schema.locations.maxQty,
      maxWeightOz: schema.locations.maxWeightOz,
      maxVolumeCuIn: schema.locations.maxVolumeCuIn,
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

  const capacityById = new Map<string, BinCapacity>();
  const locations = rows.map(({ maxQty, maxWeightOz, maxVolumeCuIn, ...location }) => {
    capacityById.set(location.locationId, capacityOf({ maxQty, maxWeightOz, maxVolumeCuIn }));
    return location;
  });
  const fill = await loadBinFill(
    db,
    organizationId,
    rows.map((row) => ({ id: row.locationId, ...capacityById.get(row.locationId)! })),
  );
  const measures = fill.size > 0 ? await loadItemMeasures(db, organizationId, itemIds) : new Map();

  for (const itemId of itemIds) {
    const measure = measures.get(itemId) ?? NO_MEASURE;
    byItem.set(
      itemId,
      baysForItem(locations, onHand, itemId).map((bay) => {
        const bin = fill.get(bay.locationId);
        if (!bin) return bay;
        const room = roomFor(capacityById.get(bay.locationId)!, bin.usage, measure);
        return { ...bay, room: Number.isFinite(room) ? room : null, fillPercent: bin.fillPercent };
      }),
    );
  }
  return byItem;
}
