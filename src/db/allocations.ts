import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { balanceKey, type MovementDraft } from "../domain/inventory";
import type { StockedBay } from "../domain/partial-pick";
import {
  freeQty,
  ownerBaysByItem,
  type BayReservation,
  type BayStock,
  type StockOwner,
} from "../domain/client-stock";
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
import {
  applyOwnerSoftHolds,
  applySoftHoldsToOnHand,
  planSoftReserves,
  reserveQtyToStore,
  type SoftHold,
  type SoftHoldQty,
} from "../domain/soft-reserve";
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
      clientId: schema.orders.clientId,
    })
    .from(schema.inventoryAllocations)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryAllocations.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryAllocations.itemId))
    .leftJoin(schema.orders, eq(schema.orders.id, schema.inventoryAllocations.orderId))
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
  const soft = await loadOpenSoftAllocations(db, organizationId, { warehouseId: options.warehouseId });
  return applySoftHoldsToOnHand(
    applyAllocationsToOnHand(available, allocations, options.excludeOrderId),
    soft,
    options.excludeOrderId,
  );
}

export function annotateAtp<T extends { locationId: string; itemId: string; qty: number }>(
  rows: T[],
  allocations: OpenAllocation[],
  available: T[],
  excludeOrderId?: string,
  soft: SoftHoldQty[] = [],
): (T & { allocated: number; atp: number })[] {
  const availableByKey = new Map(available.map((row) => [`${row.locationId}:${row.itemId}`, row.qty]));
  const withBay = rows.map((row) => {
    const heldAvailable = availableByKey.get(`${row.locationId}:${row.itemId}`) ?? 0;
    const allocated = allocatedQtyAt(allocations, row.locationId, row.itemId, excludeOrderId);
    return { ...row, allocated, atp: atpQty(heldAvailable, allocated) };
  });
  const softened = applySoftHoldsToOnHand(
    withBay.map((row) => ({ locationId: row.locationId, itemId: row.itemId, qty: row.atp })),
    soft,
    excludeOrderId,
  );
  return withBay.map((row, index) => ({ ...row, atp: softened[index]?.qty ?? row.atp }));
}

const ID_CHUNK = 90;

/** Every bay holding the items, with holds, 3PL client ownership, and open reservations, for `ownerBaysByItem`. */
export async function loadBayStock(
  db: AppDb,
  organizationId: string,
  itemIds: string[],
  warehouseId?: string,
): Promise<BayStock[]> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return [];
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
        inArray(schema.inventoryBalances.itemId, ids),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  if (rows.length === 0) return [];
  const available = await availableOnHand(db, organizationId, rows, warehouseId);
  const allocations = await loadOpenAllocations(db, organizationId, { warehouseId });
  const clientQty = new Map<string, Map<string, number>>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const owned = await db
      .select({
        locationId: schema.clientBalances.locationId,
        itemId: schema.clientBalances.itemId,
        clientId: schema.clientBalances.clientId,
        qty: schema.clientBalances.qty,
      })
      .from(schema.clientBalances)
      .where(
        and(
          eq(schema.clientBalances.organizationId, organizationId),
          inArray(schema.clientBalances.itemId, ids.slice(i, i + ID_CHUNK)),
          gt(schema.clientBalances.qty, 0),
        ),
      );
    for (const row of owned) {
      const key = balanceKey(row.locationId, row.itemId);
      const byClient = clientQty.get(key) ?? new Map<string, number>();
      byClient.set(row.clientId, (byClient.get(row.clientId) ?? 0) + row.qty);
      clientQty.set(key, byClient);
    }
  }
  const reservations = new Map<string, BayReservation[]>();
  for (const row of allocations) {
    const key = balanceKey(row.locationId, row.itemId);
    const list = reservations.get(key) ?? [];
    list.push({ orderId: row.orderId, clientId: row.clientId ?? null, qty: row.qty });
    reservations.set(key, list);
  }
  return rows.map(({ qty, ...row }, index) => {
    const key = balanceKey(row.locationId, row.itemId);
    return {
      ...row,
      onHand: qty,
      available: available[index]?.qty ?? qty,
      clientQty: clientQty.get(key) ?? new Map(),
      reservations: reservations.get(key) ?? [],
    };
  });
}

/** Bays per item an order can pick from, each cut to what the order's owner may plan there. */
export async function loadAtpBaysByItem(
  db: AppDb,
  organizationId: string,
  itemIds: string[],
  options: { owner: StockOwner; excludeOrderId?: string; warehouseId?: string },
): Promise<Map<string, StockedBay[]>> {
  const stock = await loadBayStock(db, organizationId, itemIds, options.warehouseId);
  const bays = ownerBaysByItem(stock, options);
  const soft = await loadOpenSoftAllocations(db, organizationId, { warehouseId: options.warehouseId });
  return applyOwnerSoftHolds(bays, soft, options);
}

export async function ensureAllocated(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    orderId: string;
    /** The order's 3PL client; its reservations only come from that client's stock, and own stock from no client's. */
    clientId: StockOwner;
    lines: { id: string; itemId: string; sku: string; remaining: number }[];
  },
): Promise<OpenAllocation[]> {
  const existing = await loadOpenAllocations(db, input.organizationId, { orderId: input.orderId });
  if (existing.length > 0) {
    await releaseOpenSoftAllocations(db, input.orderId, Date.now(), "converted");
    return existing;
  }

  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const stock = await loadBayStock(db, input.organizationId, itemIds, input.warehouseId);
  const ownerBays = ownerBaysByItem(stock, { owner: input.clientId, excludeOrderId: input.orderId });
  const soft = await loadOpenSoftAllocations(db, input.organizationId, { warehouseId: input.warehouseId });
  const { drafts, short } = planAllocations({
    lines: input.lines.map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: line.remaining,
    })),
    baysByItem: applyOwnerSoftHolds(ownerBays, soft, { owner: input.clientId, excludeOrderId: input.orderId }),
  });
  if (short.length > 0) {
    const first = short[0]!;
    const itemId = input.lines.find((line) => line.sku === first.sku)?.itemId;
    const anyOwner = stock
      .filter((bay) => bay.itemId === itemId)
      .reduce((sum, bay) => sum + freeQty(bay, input.orderId), 0);
    const ownerAtp = (ownerBays.get(itemId ?? "") ?? []).reduce((sum, bay) => sum + Math.max(0, bay.qty), 0);
    const ownership = anyOwner > ownerAtp ? input.clientId : undefined;
    throw new InsufficientAtpError(first.sku, first.atp, first.remaining + first.atp, undefined, ownership);
  }

  const now = Date.now();
  const statements: BatchItem<"sqlite">[] = [...releaseSoftAllocationStatements(db, input.orderId, now, "converted")];
  for (const draft of drafts) {
    statements.push(
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
  }
  if (statements.length > 0) {
    await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
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
  const softAt = await softHoldAtBays(db, organizationId, itemIds, warehouseScope);
  const taken = new Map<string, number>();

  for (const movement of restricted) {
    const locationId = movement.fromLocationId!;
    const key = `${locationId}:${movement.itemId}`;
    const onHand = loaded.get(key)?.qty ?? 0;
    const excludeOrderId = movement.type === "pick" && movement.refType === "order" ? movement.refId : undefined;
    const allocated =
      allocatedQtyAt(allocations, locationId, movement.itemId, excludeOrderId) +
      (softAt.get(`${locationId}:${movement.itemId}`) ?? 0);
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

export type OpenSoftAllocation = SoftHold & {
  id: string;
  orderLineId: string;
  sku: string;
};

export async function loadOpenSoftAllocations(
  db: AppDb,
  organizationId: string,
  options: { warehouseId?: string; orderId?: string } = {},
): Promise<OpenSoftAllocation[]> {
  const rows = await db
    .select({
      id: schema.softAllocations.id,
      orderId: schema.softAllocations.orderId,
      orderLineId: schema.softAllocations.orderLineId,
      itemId: schema.softAllocations.itemId,
      qty: schema.softAllocations.qty,
      clientId: schema.orders.clientId,
      sku: schema.items.sku,
    })
    .from(schema.softAllocations)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.softAllocations.orderId))
    .innerJoin(schema.items, eq(schema.items.id, schema.softAllocations.itemId))
    .where(
      and(
        eq(schema.softAllocations.organizationId, organizationId),
        eq(schema.softAllocations.status, "open"),
        options.warehouseId ? eq(schema.softAllocations.warehouseId, options.warehouseId) : undefined,
        options.orderId ? eq(schema.softAllocations.orderId, options.orderId) : undefined,
      ),
    );
  return rows.filter((row) => row.qty > 0);
}

async function softHoldAtBays(
  db: AppDb,
  organizationId: string,
  itemIds: string[],
  warehouseScope: Set<string>,
): Promise<Map<string, number>> {
  const soft = (await loadOpenSoftAllocations(db, organizationId)).filter((row) => itemIds.includes(row.itemId));
  if (soft.length === 0 || itemIds.length === 0) return new Map();
  const balances = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
      warehouseId: schema.locations.warehouseId,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(eq(schema.inventoryBalances.organizationId, organizationId), inArray(schema.inventoryBalances.itemId, itemIds)),
    );
  const rows = balances.filter((row) => warehouseScope.size === 0 || warehouseScope.has(row.warehouseId));
  const softened = applySoftHoldsToOnHand(rows, soft);
  const at = new Map<string, number>();
  rows.forEach((row, index) => {
    const delta = Math.max(0, row.qty - (softened[index]?.qty ?? row.qty));
    if (delta > 0) at.set(`${row.locationId}:${row.itemId}`, delta);
  });
  return at;
}

export function releaseSoftAllocationStatements(
  db: AppDb,
  orderId: string,
  now: number,
  status: "released" | "converted" = "released",
): BatchItem<"sqlite">[] {
  return [
    db
      .update(schema.softAllocations)
      .set({ status, qty: 0, releasedAt: now })
      .where(and(eq(schema.softAllocations.orderId, orderId), eq(schema.softAllocations.status, "open"))),
  ];
}

export async function releaseOpenSoftAllocations(
  db: AppDb,
  orderId: string,
  now = Date.now(),
  status: "released" | "converted" = "released",
): Promise<void> {
  await db
    .update(schema.softAllocations)
    .set({ status, qty: 0, releasedAt: now })
    .where(and(eq(schema.softAllocations.orderId, orderId), eq(schema.softAllocations.status, "open")));
}

/** Soft-reserve ATP for a new order. Short qty stays unreserved. A second call stores the same qty. */
export async function reserveOrderStock(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    orderId: string;
    clientId: StockOwner;
    lines: { id: string; itemId: string; sku: string; qty: number }[];
  },
): Promise<{ reserved: number; short: number }> {
  const [order] = await db
    .select({ stockReservedAt: schema.orders.stockReservedAt })
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .limit(1);
  const existing = await loadOpenSoftAllocations(db, input.organizationId, { orderId: input.orderId });
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const bays = await loadAtpBaysByItem(db, input.organizationId, itemIds, {
    owner: input.clientId,
    excludeOrderId: input.orderId,
    warehouseId: input.warehouseId,
  });
  const atpByItem = new Map<string, number>();
  for (const [itemId, list] of bays) {
    atpByItem.set(
      itemId,
      list.reduce((sum, row) => sum + Math.max(0, row.qty), 0),
    );
  }
  const plan = planSoftReserves({
    lines: input.lines.map((line) => ({ lineId: line.id, itemId: line.itemId, sku: line.sku, qty: line.qty })),
    atpByItem,
  });
  const now = Date.now();
  const plannedByLine = new Map(plan.reserves.map((row) => [row.lineId, row]));
  const statements: BatchItem<"sqlite">[] = [];
  for (const row of plan.reserves) {
    const prev = existing.find((held) => held.orderLineId === row.lineId);
    const qty = reserveQtyToStore(prev?.qty ?? 0, row.qty);
    if (prev && prev.qty === qty) continue;
    if (prev) {
      statements.push(
        db.update(schema.softAllocations).set({ qty }).where(eq(schema.softAllocations.id, prev.id)),
      );
    } else {
      statements.push(
        db.insert(schema.softAllocations).values({
          id: newId(),
          organizationId: input.organizationId,
          warehouseId: input.warehouseId,
          orderId: input.orderId,
          orderLineId: row.lineId,
          itemId: row.itemId,
          qty,
          status: "open",
          createdAt: now,
          releasedAt: null,
        }),
      );
    }
  }
  for (const prev of existing) {
    if (plannedByLine.has(prev.orderLineId)) continue;
    statements.push(
      db
        .update(schema.softAllocations)
        .set({ status: "released", qty: 0, releasedAt: now })
        .where(eq(schema.softAllocations.id, prev.id)),
    );
  }
  if (order && order.stockReservedAt == null) {
    statements.push(
      db
        .update(schema.orders)
        .set({ stockReservedAt: now })
        .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.stockReservedAt))),
    );
  }
  if (statements.length > 0) {
    await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return {
    reserved: plan.reserves.reduce((sum, row) => sum + row.qty, 0),
    short: plan.short.reduce((sum, row) => sum + row.shortQty, 0),
  };
}

export { InsufficientAtpError };
