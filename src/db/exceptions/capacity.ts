import { and, eq, gt, inArray, isNotNull, max, or, sql } from "drizzle-orm";
import { binUsage, CAPACITY_OVERRIDE_CODE, capacityOf, EMPTY_USAGE, overCapacity, type BinStock } from "../../domain/capacity";
import { CAPACITY_SOURCE, capacityProblems } from "../../domain/exceptions/capacity";
import { loadItemMeasures } from "../capacity";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

const ID_CHUNK = 90;

export const capacitySource: ExceptionSource = {
  ...CAPACITY_SOURCE,
  async load({ db, organizationId, warehouseId }) {
    const loc = schema.locations;
    const balances = schema.inventoryBalances;
    const limitedHere = and(
      eq(loc.organizationId, organizationId),
      eq(loc.warehouseId, warehouseId),
      or(isNotNull(loc.maxQty), isNotNull(loc.maxWeightOz), isNotNull(loc.maxVolumeCuIn)),
    );
    const [bays, stock] = await Promise.all([
      db
        .select({
          id: loc.id,
          code: loc.code,
          barcode: loc.barcode,
          maxQty: loc.maxQty,
          maxWeightOz: loc.maxWeightOz,
          maxVolumeCuIn: loc.maxVolumeCuIn,
        })
        .from(loc)
        .where(limitedHere),
      db
        .select({ locationId: balances.locationId, itemId: balances.itemId, qty: balances.qty })
        .from(balances)
        .innerJoin(loc, eq(loc.id, balances.locationId))
        .where(and(eq(balances.organizationId, organizationId), gt(balances.qty, 0), limitedHere)),
    ]);
    if (stock.length === 0) return [];

    const measured = new Set(bays.filter((bay) => bay.maxWeightOz != null || bay.maxVolumeCuIn != null).map((bay) => bay.id));
    const measures = await loadItemMeasures(
      db,
      organizationId,
      stock.filter((row) => measured.has(row.locationId)).map((row) => row.itemId),
    );
    const stockByBay = new Map<string, BinStock[]>();
    for (const row of stock) stockByBay.set(row.locationId, [...(stockByBay.get(row.locationId) ?? []), row]);
    const over = bays.flatMap((bay) => {
      const capacity = capacityOf(bay);
      const usage = binUsage(stockByBay.get(bay.id) ?? [], measures);
      return overCapacity(capacity, EMPTY_USAGE, usage) ? [{ bay, capacity, usage }] : [];
    });
    if (over.length === 0) return [];

    const audit = schema.auditEvents;
    const overridden = sql<string | null>`case when json_valid(${audit.payloadJson}) then json_extract(${audit.payloadJson}, '$.locationId') end`;
    const ids = over.map(({ bay }) => bay.id);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
    const overrides = await Promise.all(
      chunks.map((chunk) =>
        db
          .select({ locationId: overridden, at: max(audit.createdAt) })
          .from(audit)
          .where(and(eq(audit.organizationId, organizationId), eq(audit.code, CAPACITY_OVERRIDE_CODE), inArray(overridden, chunk)))
          .groupBy(overridden),
      ),
    );
    const overriddenAt = new Map(overrides.flat().map((row) => [row.locationId, row.at]));
    return capacityProblems(
      over.map(({ bay, capacity, usage }) => ({
        locationId: bay.id,
        code: bay.code,
        barcode: bay.barcode,
        warehouseId,
        capacity,
        usage,
        overriddenAt: overriddenAt.get(bay.id) ?? null,
      })),
    );
  },
};
