import { and, asc, eq } from "drizzle-orm";
import { HOLD_SOURCE, holdProblems, RELEASE_HOLD } from "../../domain/exceptions/hold";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const holdSource: ExceptionSource = {
  loadLimit: SOURCE_LIMIT + 1,
  ...HOLD_SOURCE,
  async load({ db, organizationId, warehouseId, mode }) {
    const h = schema.inventoryHolds;
    const rows = await db
      .select({
        id: h.id,
        number: h.number,
        reason: h.reason,
        notes: h.notes,
        warehouseId: h.warehouseId,
        locationId: h.locationId,
        locationCode: schema.locations.code,
        itemId: h.itemId,
        sku: schema.items.sku,
        lotCode: h.lotCode,
        createdAt: h.createdAt,
      })
      .from(h)
      .innerJoin(schema.locations, eq(schema.locations.id, h.locationId))
      .leftJoin(schema.items, eq(schema.items.id, h.itemId))
      .where(and(eq(h.organizationId, organizationId), eq(h.warehouseId, warehouseId), eq(h.status, "open")))
      .orderBy(asc(h.createdAt))
      .limit(SOURCE_LIMIT + 1);
    return holdProblems(rows, mode);
  },
  action(item, actionId) {
    if (actionId !== RELEASE_HOLD.id) return null;
    return { path: `/holds/${item.key}/release` };
  },
};
