import { and, eq, gt, inArray, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { buildAsBuilt, type AsBuiltView } from "../domain/as-built";
import type { MovementDraft } from "../domain/inventory";

export function appendAsBuiltStatements(
  db: AppDb,
  input: {
    organizationId: string;
    now: number;
    movements: MovementDraft[];
    statements: BatchItem<"sqlite">[];
  },
): void {
  const rows = buildAsBuilt(input.movements);
  for (const row of rows) {
    input.statements.push(
      db.insert(schema.asBuilt).values({
        id: newId(),
        organizationId: input.organizationId,
        refType: row.refType,
        refId: row.refId,
        parentItemId: row.parentItemId,
        parentLotCode: row.parentLotCode,
        parentSerial: row.parentSerial,
        componentItemId: row.componentItemId,
        componentLotCode: row.componentLotCode,
        componentSerial: row.componentSerial,
        qty: row.qty,
        createdAt: input.now,
      }),
    );
  }
}

export async function loadAsBuiltForItem(db: AppDb, organizationId: string, itemId: string): Promise<AsBuiltView[]> {
  return decorate(
    db,
    organizationId,
    await db
      .select()
      .from(schema.asBuilt)
      .where(
        and(
          eq(schema.asBuilt.organizationId, organizationId),
          or(eq(schema.asBuilt.parentItemId, itemId), eq(schema.asBuilt.componentItemId, itemId)),
        ),
      ),
  );
}

export async function loadAsBuiltForRef(db: AppDb, organizationId: string, refId: string): Promise<AsBuiltView[]> {
  return decorate(
    db,
    organizationId,
    await db
      .select()
      .from(schema.asBuilt)
      .where(and(eq(schema.asBuilt.organizationId, organizationId), eq(schema.asBuilt.refId, refId))),
  );
}

export async function loadAsBuiltForParentSerial(
  db: AppDb,
  organizationId: string,
  serial: string,
): Promise<AsBuiltView[]> {
  const value = serial.trim().toUpperCase();
  return decorate(
    db,
    organizationId,
    await db
      .select()
      .from(schema.asBuilt)
      .where(and(eq(schema.asBuilt.organizationId, organizationId), eq(schema.asBuilt.parentSerial, value))),
  );
}

export async function loadAsBuiltForLotCode(
  db: AppDb,
  organizationId: string,
  lotCode: string,
): Promise<AsBuiltView[]> {
  const value = lotCode.trim().toUpperCase();
  return decorate(
    db,
    organizationId,
    await db
      .select()
      .from(schema.asBuilt)
      .where(
        and(
          eq(schema.asBuilt.organizationId, organizationId),
          or(eq(schema.asBuilt.parentLotCode, value), eq(schema.asBuilt.componentLotCode, value)),
        ),
      ),
  );
}

export async function loadAsBuiltForComponent(
  db: AppDb,
  organizationId: string,
  input: { serial?: string | null; itemId?: string | null; lotCode?: string | null },
): Promise<AsBuiltView[]> {
  const filters = [eq(schema.asBuilt.organizationId, organizationId)];
  if (input.serial) filters.push(eq(schema.asBuilt.componentSerial, input.serial));
  if (input.itemId) filters.push(eq(schema.asBuilt.componentItemId, input.itemId));
  if (input.lotCode) filters.push(eq(schema.asBuilt.componentLotCode, input.lotCode));
  if (filters.length === 1) return [];
  return decorate(db, organizationId, await db.select().from(schema.asBuilt).where(and(...filters)));
}

async function decorate(
  db: AppDb,
  organizationId: string,
  rows: (typeof schema.asBuilt.$inferSelect)[],
): Promise<AsBuiltView[]> {
  if (rows.length === 0) return [];
  const itemIds = [...new Set(rows.flatMap((row) => [row.parentItemId, row.componentItemId]))];
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, itemIds)));
  const sku = new Map(items.map((row) => [row.id, row.sku]));
  return rows.map((row) => ({
    refType: row.refType,
    refId: row.refId,
    parentItemId: row.parentItemId,
    parentLotCode: row.parentLotCode,
    parentSerial: row.parentSerial,
    componentItemId: row.componentItemId,
    componentLotCode: row.componentLotCode,
    componentSerial: row.componentSerial,
    qty: row.qty,
    parentSku: sku.get(row.parentItemId) ?? row.parentItemId,
    componentSku: sku.get(row.componentItemId) ?? row.componentItemId,
  }));
}

export async function findSerialRow(db: AppDb, organizationId: string, serialCode: string) {
  const value = serialCode.trim().toUpperCase();
  const [row] = await db
    .select({
      id: schema.serials.id,
      serialCode: schema.serials.serialCode,
      status: schema.serials.status,
      itemId: schema.serials.itemId,
      locationId: schema.serials.locationId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      barcode: schema.items.barcode,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      locationBarcode: schema.locations.barcode,
    })
    .from(schema.serials)
    .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
    .leftJoin(schema.locations, eq(schema.locations.id, schema.serials.locationId))
    .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.serialCode, value)))
    .limit(1);
  return row ?? null;
}

export async function findLotRows(db: AppDb, organizationId: string, lotCode: string) {
  const value = lotCode.trim().toUpperCase();
  const onHand = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      lotCode: schema.lotBalances.lotCode,
      qty: schema.lotBalances.qty,
      expiresOn: schema.lotBalances.expiresOn,
    })
    .from(schema.lotBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.lotBalances.itemId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
    .where(
      and(
        eq(schema.lotBalances.organizationId, organizationId),
        eq(schema.lotBalances.lotCode, value),
        gt(schema.lotBalances.qty, 0),
      ),
    );
  return onHand;
}
