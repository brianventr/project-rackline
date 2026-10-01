import { and, asc, eq, exists, gt, gte, inArray, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { COUNT_SOURCE, COUNT_WINDOW_MS, countProblems, type CountRow } from "../../domain/exceptions/count";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const countSource: ExceptionSource = {
  ...COUNT_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, warehouseId, now }) {
    const c = schema.cycleCounts;
    const l = schema.cycleCountLines;
    const later = alias(schema.cycleCounts, "later_count");
    const counts = await db
      .select({
        id: c.id,
        number: c.number,
        warehouseId: c.warehouseId,
        locationId: c.locationId,
        locationCode: schema.locations.code,
        postedAt: c.postedAt,
      })
      .from(c)
      .innerJoin(schema.locations, eq(schema.locations.id, c.locationId))
      .where(
        and(
          eq(c.organizationId, organizationId),
          eq(c.warehouseId, warehouseId),
          eq(c.status, "posted"),
          gte(c.postedAt, now - COUNT_WINDOW_MS),
          exists(
            db
              .select({ id: l.id })
              .from(l)
              .where(and(eq(l.cycleCountId, c.id), ne(l.countedQty, l.systemQty))),
          ),
          notExists(
            db
              .select({ id: later.id })
              .from(later)
              .where(and(eq(later.locationId, c.locationId), eq(later.status, "posted"), gt(later.postedAt, c.postedAt))),
          ),
        ),
      )
      .orderBy(asc(c.postedAt))
      .limit(SOURCE_LIMIT + 1);
    if (counts.length === 0) return [];

    const lines = await db
      .select({ countId: l.cycleCountId, sku: schema.items.sku, systemQty: l.systemQty, countedQty: l.countedQty })
      .from(l)
      .innerJoin(schema.items, eq(schema.items.id, l.itemId))
      .where(
        and(
          inArray(
            l.cycleCountId,
            counts.map((row) => row.id),
          ),
          ne(l.countedQty, l.systemQty),
        ),
      );
    const rows: CountRow[] = counts.flatMap(({ postedAt, ...row }) =>
      postedAt == null ? [] : [{ ...row, postedAt, lines: lines.filter((line) => line.countId === row.id) }],
    );
    return countProblems(rows);
  },
};
