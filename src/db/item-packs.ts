import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { conflict } from "../lib/http";
import { isPackLevel, PACK_LEVELS, syncedAltUnit, type PackSize } from "../domain/pack-sizes";

type ItemRow = typeof schema.items.$inferSelect;
type PackRow = typeof schema.itemPacks.$inferSelect;

const ID_CHUNK = 90;

function toPack(row: PackRow): PackSize | null {
  if (!isPackLevel(row.level)) return null;
  return {
    level: row.level,
    qty: row.qty,
    barcode: row.barcode,
    weightOz: row.weightOz,
    lengthIn: row.lengthIn,
    widthIn: row.widthIn,
    heightIn: row.heightIn,
  };
}

/** Pack sizes per item id, inner → case → pallet. Items without packs are absent. */
export async function loadItemPacks(db: AppDb, organizationId: string, itemIds: string[]): Promise<Map<string, PackSize[]>> {
  const ids = [...new Set(itemIds)];
  const byItem = new Map<string, PackSize[]>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await db
      .select()
      .from(schema.itemPacks)
      .where(and(eq(schema.itemPacks.organizationId, organizationId), inArray(schema.itemPacks.itemId, ids.slice(i, i + ID_CHUNK))));
    for (const row of rows) {
      const pack = toPack(row);
      if (!pack) continue;
      const list = byItem.get(row.itemId) ?? [];
      list.push(pack);
      byItem.set(row.itemId, list);
    }
  }
  for (const list of byItem.values()) list.sort((a, b) => PACK_LEVELS.indexOf(a.level) - PACK_LEVELS.indexOf(b.level));
  return byItem;
}

export async function loadPacksForItem(db: AppDb, organizationId: string, itemId: string): Promise<PackSize[]> {
  return (await loadItemPacks(db, organizationId, [itemId])).get(itemId) ?? [];
}

/**
 * The item a scanned code names, plus the pack when it was a pack barcode. An item's own barcode
 * wins, then pack barcodes, then SKUs.
 */
export async function resolveItemScan(
  db: AppDb,
  organizationId: string,
  code: string,
): Promise<{ item: ItemRow; pack: PackSize | null } | null> {
  const value = code.trim().toUpperCase();
  if (!value) return null;
  const [byBarcode] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.barcode, value)))
    .limit(1);
  if (byBarcode) return { item: byBarcode, pack: null };
  const [packRow] = await db
    .select()
    .from(schema.itemPacks)
    .where(and(eq(schema.itemPacks.organizationId, organizationId), eq(schema.itemPacks.barcode, value)))
    .limit(1);
  const pack = packRow ? toPack(packRow) : null;
  if (packRow && pack) {
    const [item] = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.id, packRow.itemId)))
      .limit(1);
    if (item) return { item, pack };
  }
  const [bySku] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.sku, value)))
    .limit(1);
  return bySku ? { item: bySku, pack: null } : null;
}

/** A pack barcode must scan as that pack only: not an item barcode or SKU, another pack, or a bay. */
export async function assertPackBarcodesFree(db: AppDb, organizationId: string, itemId: string, packs: PackSize[]) {
  const codes = packs.flatMap((pack) => (pack.barcode ? [pack.barcode] : []));
  if (!codes.length) return;
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku, barcode: schema.items.barcode })
    .from(schema.items)
    .where(
      and(
        eq(schema.items.organizationId, organizationId),
        or(inArray(schema.items.barcode, codes), inArray(schema.items.sku, codes)),
      ),
    );
  const item = items[0];
  if (item) {
    const code = codes.find((value) => value === item.barcode || value === item.sku)!;
    if (item.id === itemId) {
      conflict(`${code} is this item's own ${item.barcode === code ? "barcode" : "SKU"}. Give the pack its own label.`);
    }
    conflict(`${code} already scans as ${item.sku}`);
  }
  await assertNotPackBarcode(db, organizationId, codes, itemId);
  const [bay] = await db
    .select({ code: schema.locations.code, barcode: schema.locations.barcode })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.organizationId, organizationId),
        or(inArray(schema.locations.barcode, codes), inArray(schema.locations.code, codes)),
      ),
    )
    .limit(1);
  if (bay) conflict(`${codes.find((value) => value === bay.barcode || value === bay.code)} already scans as bay ${bay.code}`);
}

/** Item barcodes and SKUs cannot reuse a pack barcode (other than `exceptItemId`'s own packs). */
export async function assertNotPackBarcode(db: AppDb, organizationId: string, codes: string[], exceptItemId?: string) {
  const values = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (!values.length) return;
  const [taken] = await db
    .select({ barcode: schema.itemPacks.barcode, level: schema.itemPacks.level, sku: schema.items.sku })
    .from(schema.itemPacks)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemPacks.itemId))
    .where(
      and(
        eq(schema.itemPacks.organizationId, organizationId),
        inArray(schema.itemPacks.barcode, values),
        exceptItemId ? ne(schema.itemPacks.itemId, exceptItemId) : undefined,
      ),
    )
    .limit(1);
  if (taken) conflict(`${taken.barcode} is already the ${taken.level} barcode on ${taken.sku}`);
}

/** Replaces an item's pack levels and keeps its alt unit in step, in one batch. */
export async function replaceItemPacks(db: AppDb, organizationId: string, item: ItemRow, packs: PackSize[]) {
  const now = Date.now();
  const alt = syncedAltUnit({ altUom: item.altUom, altPerStock: item.altPerStock }, packs);
  const statements: BatchItem<"sqlite">[] = [
    db.delete(schema.itemPacks).where(and(eq(schema.itemPacks.organizationId, organizationId), eq(schema.itemPacks.itemId, item.id))),
  ];
  if (packs.length) {
    statements.push(
      db.insert(schema.itemPacks).values(
        packs.map((pack) => ({
          id: newId(),
          organizationId,
          itemId: item.id,
          ...pack,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }
  if (alt) {
    statements.push(
      db
        .update(schema.items)
        .set(alt)
        .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.id, item.id))),
    );
  }
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return alt ?? { altUom: item.altUom, altPerStock: item.altPerStock };
}
