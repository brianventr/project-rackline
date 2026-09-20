import { and, eq, gte, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AppDb } from "./stock";
import * as schema from "./schema";
import { newId } from "../lib/ids";
import type { LaborVerbName } from "../domain/labor";
import {
  LABOR_KPI_EVENT_CAP,
  type LaborFact,
  type LaborItemFlags,
  type LaborKpiInput,
  type LaborLocation,
  type LaborMember,
} from "../domain/labor-kpis";

export async function recordLaborEvent(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    userId: string;
    verb: LaborVerbName;
    refType: string;
    refId: string;
    qty?: number | null;
    durationSec?: number | null;
    notes?: string | null;
    now?: number;
  },
): Promise<void> {
  await db.insert(schema.laborEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    userId: input.userId,
    verb: input.verb,
    refType: input.refType,
    refId: input.refId,
    qty: input.qty ?? null,
    durationSec: input.durationSec ?? null,
    notes: input.notes ?? null,
    createdAt: input.now ?? Date.now(),
  });
}

export async function loadLaborKpiInput(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId?: string;
    from: number;
    to: number;
    userId?: string;
    itemId?: string;
  },
): Promise<LaborKpiInput> {
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");

  const memberRows = await db
    .select({
      userId: schema.user.id,
      userName: schema.user.name,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, input.organizationId));

  const members: LaborMember[] = memberRows.map((row) => ({
    userId: row.userId,
    userName: row.userName,
    role: row.role,
  }));

  const itemRows = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      type: schema.items.type,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, input.organizationId));

  const items: LaborItemFlags[] = itemRows.map((row) => ({
    itemId: row.itemId,
    sku: row.sku,
    name: row.name,
    type: row.type,
    trackLot: Boolean(row.trackLot),
    trackSerial: Boolean(row.trackSerial),
    catchWeight: Boolean(row.catchWeight),
    trackExpiry: Boolean(row.trackExpiry),
  }));

  const locationRows = await db
    .select({
      id: schema.locations.id,
      warehouseId: schema.locations.warehouseId,
      posX: schema.locations.posX,
      posY: schema.locations.posY,
    })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.organizationId, input.organizationId),
        input.warehouseId ? eq(schema.locations.warehouseId, input.warehouseId) : undefined,
      ),
    );
  const locations: LaborLocation[] = locationRows;

  const movementRows = await db
    .select({
      userId: schema.inventoryMovements.createdBy,
      createdAt: schema.inventoryMovements.createdAt,
      type: schema.inventoryMovements.type,
      refType: schema.inventoryMovements.refType,
      refId: schema.inventoryMovements.refId,
      itemId: schema.inventoryMovements.itemId,
      qty: schema.inventoryMovements.qty,
      fromLocationId: schema.inventoryMovements.fromLocationId,
      toLocationId: schema.inventoryMovements.toLocationId,
      reason: schema.inventoryMovements.reason,
    })
    .from(schema.inventoryMovements)
    .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, input.organizationId),
        gte(schema.inventoryMovements.createdAt, input.from),
        lte(schema.inventoryMovements.createdAt, input.to),
        input.userId ? eq(schema.inventoryMovements.createdBy, input.userId) : undefined,
        input.itemId ? eq(schema.inventoryMovements.itemId, input.itemId) : undefined,
        input.warehouseId
          ? or(eq(fromLoc.warehouseId, input.warehouseId), eq(toLoc.warehouseId, input.warehouseId))
          : undefined,
      ),
    )
    .limit(LABOR_KPI_EVENT_CAP);

  const packRows = await db
    .select({
      userId: schema.packEvents.userId,
      createdAt: schema.packEvents.createdAt,
      orderId: schema.packEvents.orderId,
      itemId: schema.packEvents.itemId,
      qty: schema.packEvents.qty,
    })
    .from(schema.packEvents)
    .where(
      and(
        eq(schema.packEvents.organizationId, input.organizationId),
        gte(schema.packEvents.createdAt, input.from),
        lte(schema.packEvents.createdAt, input.to),
        input.userId ? eq(schema.packEvents.userId, input.userId) : undefined,
        input.itemId ? eq(schema.packEvents.itemId, input.itemId) : undefined,
        input.warehouseId ? eq(schema.packEvents.warehouseId, input.warehouseId) : undefined,
      ),
    )
    .limit(LABOR_KPI_EVENT_CAP);

  const facts: LaborFact[] = [
    ...movementRows.map((row) => ({
      userId: row.userId,
      createdAt: row.createdAt,
      type: row.type,
      refType: row.refType,
      refId: row.refId,
      itemId: row.itemId,
      qty: row.qty,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      reason: row.reason,
    })),
    ...packRows.map((row) => ({
      userId: row.userId,
      createdAt: row.createdAt,
      type: "pack",
      refType: "order",
      refId: row.orderId,
      itemId: row.itemId,
      qty: row.qty,
      fromLocationId: null,
      toLocationId: null,
      reason: null,
    })),
  ];

  return { members, items, locations, facts };
}
