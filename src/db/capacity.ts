import { and, eq, gt, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { loadItemPacks } from "./item-packs";
import { newId } from "../lib/ids";
import { parseBalanceKey, type MovementDraft, type StockPlan } from "../domain/inventory";
import {
  binUsage,
  CAPACITY_OVERRIDE_ACTION,
  CAPACITY_OVERRIDE_CODE,
  capacityBreaches,
  capacityOf,
  capacityOverrideSummary,
  eachMeasure,
  fillPercent,
  fillsBay,
  hasCapacity,
  LocationFullError,
  unmeasuredItems,
  type BinCapacity,
  type BinStock,
  type BinUsage,
  type EachMeasure,
} from "../domain/capacity";

const ID_CHUNK = 90;

/** Who overrode a full bay. The audit row is written in the same batch as the stock. */
export type CapacityOverride = { userId: string; email: string; name: string; method: string; path: string };

export type CapacityLocation = { id: string; code: string } & BinCapacity;

export type BinFill = { usage: BinUsage; fillPercent: number | null; unmeasured: string[] };

export async function loadItemMeasures(db: AppDb, organizationId: string, itemIds: string[]): Promise<Map<string, EachMeasure>> {
  const ids = [...new Set(itemIds)];
  const measures = new Map<string, EachMeasure>();
  if (ids.length === 0) return measures;
  const packs = await loadItemPacks(db, organizationId, ids);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await db
      .select({
        id: schema.items.id,
        shipWeightOz: schema.items.shipWeightOz,
        shipLengthIn: schema.items.shipLengthIn,
        shipWidthIn: schema.items.shipWidthIn,
        shipHeightIn: schema.items.shipHeightIn,
      })
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, ids.slice(i, i + ID_CHUNK))));
    for (const row of rows) measures.set(row.id, eachMeasure(row, packs.get(row.id) ?? []));
  }
  return measures;
}

/** Every positive balance at the bays, whatever the SKU. */
export async function loadBinStock(db: AppDb, organizationId: string, locationIds: string[]): Promise<BinStock[]> {
  const ids = [...new Set(locationIds)];
  const rows: BinStock[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    rows.push(
      ...(await db
        .select({
          locationId: schema.inventoryBalances.locationId,
          itemId: schema.inventoryBalances.itemId,
          qty: schema.inventoryBalances.qty,
        })
        .from(schema.inventoryBalances)
        .where(
          and(
            eq(schema.inventoryBalances.organizationId, organizationId),
            inArray(schema.inventoryBalances.locationId, ids.slice(i, i + ID_CHUNK)),
            gt(schema.inventoryBalances.qty, 0),
          ),
        )),
    );
  }
  return rows;
}

function byLocation(rows: BinStock[]): Map<string, BinStock[]> {
  const grouped = new Map<string, BinStock[]>();
  for (const row of rows) {
    const list = grouped.get(row.locationId) ?? [];
    list.push(row);
    grouped.set(row.locationId, list);
  }
  return grouped;
}

/** Usage and fill % for each bay that has a limit. Bays without one are absent. */
export async function loadBinFill(
  db: AppDb,
  organizationId: string,
  locations: ({ id: string } & Partial<BinCapacity>)[],
): Promise<Map<string, BinFill>> {
  const fill = new Map<string, BinFill>();
  const limited = locations.filter((row) => hasCapacity(row));
  if (limited.length === 0) return fill;
  const stock = await loadBinStock(
    db,
    organizationId,
    limited.map((row) => row.id),
  );
  const measures = await loadItemMeasures(
    db,
    organizationId,
    stock.map((row) => row.itemId),
  );
  const grouped = byLocation(stock);
  for (const location of limited) {
    const rows = grouped.get(location.id) ?? [];
    const capacity = capacityOf(location);
    const usage = binUsage(rows, measures);
    fill.set(location.id, {
      usage,
      fillPercent: fillPercent(capacity, usage),
      unmeasured: unmeasuredItems(capacity, rows, measures),
    });
  }
  return fill;
}

/**
 * Refuses a plan that fills a bay past a limit. With an owner's override it returns audit rows
 * instead, one per bay, to go in the same batch as the stock.
 */
export async function capacityStatements(
  db: AppDb,
  input: {
    organizationId: string;
    now: number;
    plan: StockPlan;
    movements: MovementDraft[];
    locations: CapacityLocation[];
    override?: CapacityOverride;
  },
): Promise<BatchItem<"sqlite">[]> {
  const targets = new Set(input.movements.filter(fillsBay).map((movement) => movement.toLocationId!));
  const limited = input.locations.filter((row) => targets.has(row.id) && hasCapacity(row));
  if (limited.length === 0) return [];
  const ids = new Set(limited.map((row) => row.id));
  const stock = await loadBinStock(db, input.organizationId, [...ids]);
  const planned = [...input.plan.balances]
    .map(([key, qty]) => ({ ...parseBalanceKey(key), qty }))
    .filter((row) => ids.has(row.locationId));
  const measures = await loadItemMeasures(
    db,
    input.organizationId,
    [...stock, ...planned].map((row) => row.itemId),
  );
  const breaches = capacityBreaches({ locations: limited, stock, planned, measures });
  if (breaches.length === 0) return [];
  const override = input.override;
  if (!override) throw new LocationFullError(breaches[0]!.locationCode, breaches[0]!.breach);
  return breaches.map(({ locationId, locationCode, breach }) =>
    db.insert(schema.auditEvents).values({
      id: newId(),
      organizationId: input.organizationId,
      actorUserId: override.userId,
      actorEmail: override.email,
      actorName: override.name,
      action: CAPACITY_OVERRIDE_ACTION,
      method: override.method,
      path: override.path,
      status: 200,
      code: CAPACITY_OVERRIDE_CODE,
      summary: capacityOverrideSummary(locationCode, breach),
      payloadJson: JSON.stringify({ locationId, locationCode, ...breach }),
      createdAt: input.now,
    }),
  );
}
