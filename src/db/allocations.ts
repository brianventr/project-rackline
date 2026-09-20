import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import type { MovementDraft } from "../domain/inventory";
import type { StockedBay } from "../domain/partial-pick";
import {
  allocatedQtyAt,
  applyAllocationsToOnHand,
  assertAtpForMove,
  atpQty,
  consumeAllocations,
  InsufficientAtpError,
  isAtpRestrictedType,
  matchingAllocation,
  planAllocations,
  type OpenAllocation,
} from "../domain/allocations";
import { availableOnHand } from "./holds";

export async function loadOpenAllocations(
  db: AppDb,
  organizationId: string,
  options: { warehouseId?: string; orderId?: string } = {},
): Promise<OpenAllocation[]> {
  const rows = await db
    .select({
      id: schema.inventoryAllocations.id,
      orderId: schema.inventoryAllocations.orderId,
      orderLineId: schema.inventoryAllocations.orderLineId,
      locationId: schema.inventoryAllocations.locationId,
      locationCode: schema.locations.code,
      itemId: schema.inventoryAllocations.itemId,
      sku: schema.items.sku,
      qty: schema.inventoryAllocations.qty,
    })
    .from(schema.inventoryAllocations)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryAllocations.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryAllocations.itemId))
    .where(
      and(
        eq(schema.inventoryAllocations.organizationId, organizationId),
        eq(schema.inventoryAllocations.status, "open"),
        options.warehouseId ? eq(schema.inventoryAllocations.warehouseId, options.warehouseId) : undefined,
        options.orderId ? eq(schema.inventoryAllocations.orderId, options.orderId) : undefined,
      ),
    );
  return rows.filter((row) => row.qty > 0);
}

export async function atpOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  db: AppDb,
  organizationId: string,
  rows: T[],
  options: { warehouseId?: string; excludeOrderId?: string } = {},
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const available = await availableOnHand(db, organizationId, rows, options.warehouseId);
  const allocations = await loadOpenAllocations(db, organizationId, { warehouseId: options.warehouseId });
  return applyAllocationsToOnHand(available, allocations, options.excludeOrderId);
}

export function annotateAtp<T extends { locationId: string; itemId: string; qty: number }>(
  rows: T[],
  allocations: OpenAllocation[],
  available: T[],
  excludeOrderId?: string,
): (T & { allocated: number; atp: number })[] {
  const availableByKey = new Map(available.map((row) => [`${row.locationId}:${row.itemId}`, row.qty]));
  return rows.map((row) => {
    const heldAvailable = availableByKey.get(`${row.locationId}:${row.itemId}`) ?? 0;
    const allocated = allocatedQtyAt(allocations, row.locationId, row.itemId, excludeOrderId);
    return { ...row, allocated, atp: atpQty(heldAvailable, allocated) };
  });
}

export async function loadAtpBaysByItem(
  db: AppDb,
  organizationId: string,
  itemIds: string[],
  excludeOrderId?: string,
  warehouseId?: string,
): Promise<Map<string, StockedBay[]>> {
  const byItem = new Map<string, StockedBay[]>();
  if (itemIds.length === 0) return byItem;
  const rows = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      qty: schema.inventoryBalances.qty,
      type: schema.locations.type,
      slotRole: schema.locations.slotRole,
      zoneId: schema.locations.zoneId,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        inArray(schema.inventoryBalances.itemId, itemIds),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const available = await atpOnHand(db, organizationId, rows, { excludeOrderId, warehouseId });
  for (const row of available) {
    const list = byItem.get(row.itemId) ?? [];
    list.push({
      locationId: row.locationId,
      locationCode: row.locationCode,
      locationName: row.locationName,
      barcode: row.barcode,
      qty: row.qty,
      type: row.type,
      slotRole: row.slotRole,
      zoneId: row.zoneId,
    });
    byItem.set(row.itemId, list);
  }
  return byItem;
}

export async function ensureAllocated(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    orderId: string;
    lines: { id: string; itemId: string; sku: string; remaining: number }[];
  },
): Promise<OpenAllocation[]> {
  const existing = await loadOpenAllocations(db, input.organizationId, { orderId: input.orderId });
  if (existing.length > 0) return existing;

  const baysByItem = await loadAtpBaysByItem(
    db,
    input.organizationId,
    [...new Set(input.lines.map((line) => line.itemId))],
    input.orderId,
  );
  const { drafts, short } = planAllocations({
    lines: input.lines.map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: line.remaining,
    })),
    baysByItem,
  });
  if (short.length > 0) {
    const first = short[0]!;
    throw new InsufficientAtpError(first.sku, first.atp, first.remaining + first.atp);
  }
  if (drafts.length === 0) return [];

  const now = Date.now();
  const statements = drafts.map((draft) =>
    db.insert(schema.inventoryAllocations).values({
      id: newId(),
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      orderId: input.orderId,
      orderLineId: draft.orderLineId,
      locationId: draft.locationId,
      itemId: draft.itemId,
      qty: draft.qty,
      status: "open",
      createdAt: now,
      releasedAt: null,
    }),
  );
  await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return loadOpenAllocations(db, input.organizationId, { orderId: input.orderId });
}

export function consumeAllocationStatements(
  db: AppDb,
  allocations: OpenAllocation[],
  orderLineId: string,
  locationId: string,
  qty: number,
  now: number,
): BatchItem<"sqlite">[] {
  return consumeAllocations(allocations, orderLineId, locationId, qty).map((row) =>
    db
      .update(schema.inventoryAllocations)
      .set(
        row.qty > 0
          ? { qty: row.qty }
          : { qty: 0, status: "released", releasedAt: now },
      )
      .where(eq(schema.inventoryAllocations.id, row.id)),
  );
}

export function restoreAllocationStatements(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    orderId: string;
    allocations: OpenAllocation[];
    orderLineId: string;
    locationId: string;
    itemId: string;
    qty: number;
    now: number;
  },
): BatchItem<"sqlite">[] {
  if (!Number.isInteger(input.qty) || input.qty <= 0) return [];
  const existing = matchingAllocation(input.allocations, input.orderLineId, input.locationId);
  if (existing) {
    const nextQty = existing.qty + input.qty;
    existing.qty = nextQty;
    return [
      db
        .update(schema.inventoryAllocations)
        .set({ qty: nextQty, status: "open", releasedAt: null })
        .where(eq(schema.inventoryAllocations.id, existing.id)),
    ];
  }
  const id = newId();
  input.allocations.push({
    id,
    orderId: input.orderId,
    orderLineId: input.orderLineId,
    locationId: input.locationId,
    locationCode: "",
    itemId: input.itemId,
    sku: "",
    qty: input.qty,
  });
  return [
    db.insert(schema.inventoryAllocations).values({
      id,
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      orderId: input.orderId,
      orderLineId: input.orderLineId,
      locationId: input.locationId,
      itemId: input.itemId,
      qty: input.qty,
      status: "open",
      createdAt: input.now,
      releasedAt: null,
    }),
  ];
}

export function releaseAllocationStatements(db: AppDb, orderId: string, now: number): BatchItem<"sqlite">[] {
  return [
    db
      .update(schema.inventoryAllocations)
      .set({ status: "released", qty: 0, releasedAt: now })
      .where(and(eq(schema.inventoryAllocations.orderId, orderId), eq(schema.inventoryAllocations.status, "open"))),
  ];
}

export async function releaseOpenAllocations(db: AppDb, orderId: string, now = Date.now()): Promise<void> {
  await db
    .update(schema.inventoryAllocations)
    .set({ status: "released", qty: 0, releasedAt: now })
    .where(and(eq(schema.inventoryAllocations.orderId, orderId), eq(schema.inventoryAllocations.status, "open")));
}

export async function assertOutboundAtp(
  db: AppDb,
  organizationId: string,
  movements: MovementDraft[],
  loaded: Map<string, { id: string; qty: number }>,
  warehouseScope: Set<string> = new Set(),
): Promise<void> {
  const restricted = movements.filter(
    (movement) => isAtpRestrictedType(movement.type) && movement.fromLocationId && movement.qty > 0,
  );
  if (restricted.length === 0) return;

  let allocations = await loadOpenAllocations(db, organizationId);
  if (warehouseScope.size > 0 && allocations.length > 0) {
    const locRows = await db
      .select({ id: schema.locations.id, warehouseId: schema.locations.warehouseId })
      .from(schema.locations)
      .where(
        inArray(schema.locations.id, [...new Set(allocations.map((row) => row.locationId))]),
      );
    const whByLoc = new Map(locRows.map((row) => [row.id, row.warehouseId]));
    allocations = allocations.filter((row) => {
      const wh = whByLoc.get(row.locationId);
      return wh != null && warehouseScope.has(wh);
    });
  }
  const locationIds = [...new Set(restricted.map((movement) => movement.fromLocationId!))];
  const itemIds = [...new Set(restricted.map((movement) => movement.itemId))];
  const [locations, items] = await Promise.all([
    db
      .select({ id: schema.locations.id, code: schema.locations.code })
      .from(schema.locations)
      .where(inArray(schema.locations.id, locationIds)),
    db
      .select({ id: schema.items.id, sku: schema.items.sku })
      .from(schema.items)
      .where(inArray(schema.items.id, itemIds)),
  ]);
  const codeById = new Map(locations.map((row) => [row.id, row.code]));
  const skuById = new Map(items.map((row) => [row.id, row.sku]));
  const taken = new Map<string, number>();

  for (const movement of restricted) {
    const locationId = movement.fromLocationId!;
    const key = `${locationId}:${movement.itemId}`;
    const onHand = loaded.get(key)?.qty ?? 0;
    const excludeOrderId = movement.type === "pick" && movement.refType === "order" ? movement.refId : undefined;
    const allocated = allocatedQtyAt(allocations, locationId, movement.itemId, excludeOrderId);
    const already = taken.get(key) ?? 0;
    assertAtpForMove(
      onHand - already,
      allocated,
      movement.qty,
      skuById.get(movement.itemId) ?? movement.itemId,
      codeById.get(locationId),
    );
    taken.set(key, already + movement.qty);
  }
}

export { InsufficientAtpError };
