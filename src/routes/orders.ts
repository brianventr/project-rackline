import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planPick, type MovementDraft, type StockPlan } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { fulfillShopifyOrder } from "../domain/shopify-fulfill";
import { canPackOrder, canPickOrder, canShipOrder, canStartPack, canStartPick, canCancelOrder, canUnpickOrder } from "../domain/status";
import { buildShippingLabel, isCarrierService, resolveCarrier } from "../domain/shipping-label";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import {
  applyPartialPick,
  hasUnpicked,
  isFullyPicked,
  remainingToPick,
  suggestPickBay,
  OverPickError,
  type PickLine,
  type StockedBay,
} from "../domain/partial-pick";
import {
  applyPartialPack,
  hasUnpacked,
  isFullyPacked,
  remainingToPack,
  OverPackError,
  type PackLine,
} from "../domain/partial-pack";
import {
  consumeAllocationStatements,
  ensureAllocated,
  loadAtpBaysByItem,
  loadOpenAllocations,
  releaseAllocationStatements,
} from "../db/allocations";
import { cancelOrderDocument, persistUnpick, remainingToUnpick } from "../db/unpick";
import { OverUnpickError } from "../domain/partial-unpick";
import type { OpenAllocation } from "../domain/allocations";
import { resolveLineStockQty, UomConversionError } from "../domain/uom";

export const ordersRoute = new Hono<AppEnv>();

type IncomingPick = {
  lineId?: string;
  itemId?: string;
  qty?: number;
  altQty?: number;
  lotCode?: string;
  serials?: string | string[];
  weightGrams?: number;
};

function asPickLine(line: { id: string; sku: string; qty: number; qtyPicked: number }): PickLine {
  return {
    lineId: line.id,
    sku: line.sku,
    qtyOrdered: line.qty,
    qtyPicked: line.qtyPicked,
  };
}

function asPackLine(line: { id: string; sku: string; qtyPicked: number; qtyPacked: number }): PackLine {
  return {
    lineId: line.id,
    sku: line.sku,
    qtyPicked: line.qtyPicked,
    qtyPacked: line.qtyPacked,
  };
}

async function suggestedByItem(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  itemIds: string[],
  excludeOrderId?: string,
): Promise<Map<string, StockedBay[]>> {
  return loadAtpBaysByItem(db, organizationId, itemIds, excludeOrderId);
}

function withRemaining<T extends { id: string; sku: string; qty: number; qtyPicked: number; qtyPacked: number }>(line: T) {
  return {
    ...line,
    remaining: remainingToPick(asPickLine(line)),
    packRemaining: remainingToPack(asPackLine(line)),
    unpickRemaining: remainingToUnpick({
      lineId: line.id,
      sku: line.sku,
      qtyPicked: line.qtyPicked,
      qtyPacked: line.qtyPacked,
    }),
  };
}

function withAllocations<T extends { id: string }>(lines: T[], allocations: OpenAllocation[]) {
  return lines.map((line) => {
    const reserved = allocations.filter((row) => row.orderLineId === line.id);
    return {
      ...line,
      allocatedQty: reserved.reduce((sum, row) => sum + row.qty, 0),
      allocations: reserved.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        locationCode: row.locationCode,
        itemId: row.itemId,
        sku: row.sku,
        qty: row.qty,
      })),
    };
  });
}

function allocatedUnits(allocations: OpenAllocation[]): number {
  return allocations.reduce((sum, row) => sum + row.qty, 0);
}

async function withSuggestions<
  T extends { id: string; itemId: string; sku: string; qty: number; qtyPicked: number; qtyPacked: number },
>(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  lines: T[],
  excludeOrderId?: string,
  preferredZoneId?: string | null,
) {
  const bays = await suggestedByItem(
    db,
    organizationId,
    [...new Set(lines.map((line) => line.itemId))],
    excludeOrderId,
  );
  return lines.map((line) => {
    const remaining = remainingToPick(asPickLine(line));
    const suggested =
      remaining > 0 ? suggestPickBay(bays.get(line.itemId) ?? [], remaining, preferredZoneId) : null;
    return {
      ...line,
      remaining,
      packRemaining: remainingToPack(asPackLine(line)),
      unpickRemaining: remainingToUnpick({
        lineId: line.id,
        sku: line.sku,
        qtyPicked: line.qtyPicked,
        qtyPacked: line.qtyPacked,
      }),
      suggestedLocation: suggested
        ? {
            locationId: suggested.locationId,
            locationCode: suggested.locationCode,
            locationName: suggested.locationName,
            barcode: suggested.barcode,
            qty: suggested.qty,
          }
        : null,
    };
  });
}

const orderLineSelect = {
  id: schema.orderLines.id,
  itemId: schema.orderLines.itemId,
  qty: schema.orderLines.qty,
  qtyPicked: schema.orderLines.qtyPicked,
  qtyPacked: schema.orderLines.qtyPacked,
  sku: schema.items.sku,
  itemName: schema.items.name,
  trackLot: schema.items.trackLot,
  trackSerial: schema.items.trackSerial,
  catchWeight: schema.items.catchWeight,
  altPerStock: schema.items.altPerStock,
  shopifyLineItemId: schema.orderLines.shopifyLineItemId,
  shopifyFulfillmentLineItemId: schema.orderLines.shopifyFulfillmentLineItemId,
};

async function orderWithLines(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  id: string,
  options: { suggest?: boolean } = { suggest: true },
) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) notFound("Order not found");
  const lines = await db
    .select(orderLineSelect)
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, id));
  const allocations = await loadOpenAllocations(db, organizationId, { orderId: id });
  let preferredZoneId: string | null = null;
  if (order.waveId) {
    const [wave] = await db
      .select({ zoneId: schema.waves.zoneId })
      .from(schema.waves)
      .where(and(eq(schema.waves.id, order.waveId), eq(schema.waves.organizationId, organizationId)))
      .limit(1);
    preferredZoneId = wave?.zoneId ?? null;
  }
  const decorated = options.suggest
    ? await withSuggestions(db, organizationId, lines, order.id, preferredZoneId)
    : lines.map(withRemaining);
  return {
    ...order,
    allocatedUnits: allocatedUnits(allocations),
    allocations,
    lines: withAllocations(decorated, allocations),
  };
}

function resolveIncoming(
  lines: {
    id: string;
    itemId: string;
    remaining: number;
    sku: string;
    catchWeight?: boolean;
    altPerStock?: number | null;
  }[],
  bodyLines?: IncomingPick[],
): { lineId: string; qty: number; lotCode: string | null; serials: string[]; weightGrams: number | null }[] {
  if (Array.isArray(bodyLines) && bodyLines.length > 0) {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const byItem = new Map(lines.map((line) => [line.itemId, line]));
    return bodyLines.map((row) => {
      const line =
        (row.lineId ? byId.get(row.lineId) : undefined) ?? (row.itemId ? byItem.get(row.itemId) : undefined);
      if (!line) badRequest("Line is not on this order");
      let qty: number;
      if (row.qty == null && row.altQty == null) {
        qty = line.remaining;
      } else {
        try {
          qty = resolveLineStockQty({
            qty: row.qty == null ? undefined : requireInt(row.qty, "qty"),
            altQty: row.altQty == null ? undefined : requireInt(row.altQty, "altQty"),
            altPerStock: line.altPerStock,
          });
        } catch (err) {
          if (err instanceof UomConversionError) badRequest(err.message);
          throw err;
        }
      }
      return {
        lineId: line.id,
        qty,
        lotCode: row.lotCode?.trim() || null,
        serials: parseSerialList(row.serials),
        weightGrams: lineCatchWeight(line.catchWeight, line.sku, row.weightGrams),
      };
    });
  }
  return lines
    .filter((line) => line.remaining > 0)
    .map((line) => ({
      lineId: line.id,
      qty: line.remaining,
      lotCode: null,
      serials: [] as string[],
      weightGrams: lineCatchWeight(line.catchWeight, line.sku, undefined),
    }));
}

function resolveIncomingPack(
  lines: { id: string; itemId: string; packRemaining: number }[],
  bodyLines?: { lineId?: string; itemId?: string; qty?: number }[],
): { lineId: string; qty: number }[] {
  if (Array.isArray(bodyLines) && bodyLines.length > 0) {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const byItem = new Map(lines.map((line) => [line.itemId, line]));
    return bodyLines.map((row) => {
      const line =
        (row.lineId ? byId.get(row.lineId) : undefined) ?? (row.itemId ? byItem.get(row.itemId) : undefined);
      if (!line) badRequest("Line is not on this order");
      const qty = row.qty === undefined || row.qty === null ? line.packRemaining : requireInt(row.qty, "qty");
      return { lineId: line.id, qty };
    });
  }
  return lines.filter((line) => line.packRemaining > 0).map((line) => ({ lineId: line.id, qty: line.packRemaining }));
}

function resolveIncomingUnpick(
  lines: { id: string; itemId: string; sku: string; qtyPicked: number; qtyPacked: number }[],
  bodyLines?: { lineId?: string; itemId?: string; qty?: number }[],
): { lineId: string; qty: number }[] {
  const decorated = lines.map((line) => ({
    ...line,
    unpickRemaining: remainingToUnpick({
      lineId: line.id,
      sku: line.sku,
      qtyPicked: line.qtyPicked,
      qtyPacked: line.qtyPacked,
    }),
  }));
  if (Array.isArray(bodyLines) && bodyLines.length > 0) {
    const byId = new Map(decorated.map((line) => [line.id, line]));
    const byItem = new Map(decorated.map((line) => [line.itemId, line]));
    return bodyLines.map((row) => {
      const line =
        (row.lineId ? byId.get(row.lineId) : undefined) ?? (row.itemId ? byItem.get(row.itemId) : undefined);
      if (!line) badRequest("Line is not on this order");
      const qty = row.qty === undefined || row.qty === null ? line.unpickRemaining : requireInt(row.qty, "qty");
      return { lineId: line.id, qty };
    });
  }
  return decorated.filter((line) => line.unpickRemaining > 0).map((line) => ({ lineId: line.id, qty: line.unpickRemaining }));
}

ordersRoute.get("/orders", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.organizationId, organizationId))
    .orderBy(desc(schema.orders.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.orderLines.id,
      orderId: schema.orderLines.orderId,
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      qtyPacked: schema.orderLines.qtyPacked,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(
      inArray(
        schema.orderLines.orderId,
        rows.map((row) => row.id),
      ),
    );
  const byOrder = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byOrder.get(line.orderId) ?? [];
    list.push(line);
    byOrder.set(line.orderId, list);
  }
  const allocations = await loadOpenAllocations(db, organizationId);
  const allocsByOrder = new Map<string, OpenAllocation[]>();
  for (const row of allocations) {
    const list = allocsByOrder.get(row.orderId) ?? [];
    list.push(row);
    allocsByOrder.set(row.orderId, list);
  }
  return c.json(
    rows.map((row) => {
      const reserved = allocsByOrder.get(row.id) ?? [];
      return {
        ...row,
        allocatedUnits: allocatedUnits(reserved),
        allocations: reserved,
        lines: withAllocations((byOrder.get(row.id) ?? []).map(withRemaining), reserved),
      };
    }),
  );
});

ordersRoute.get("/orders/:id", async (c) => {
  return c.json(await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

ordersRoute.post("/orders", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    customerName?: string;
    shipToAddress?: string;
    clientId?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const customerName = requireString(body.customerName, "customerName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one order line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  if (body.clientId) {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, body.clientId), eq(schema.clients.organizationId, organizationId)))
      .limit(1);
    if (!client) badRequest("Client not found");
  }
  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), orderId: id, itemId, qty, qtyPicked: 0 });
  }

  await db.batch([
    db.insert(schema.orders).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ORD"),
      customerName,
      status: "open",
      createdAt: Date.now(),
      shipToAddress: body.shipToAddress?.trim() || null,
      clientId: body.clientId || null,
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  return c.json(await orderWithLines(db, organizationId, id), 201);
});

ordersRoute.post("/orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPick(order.status)) conflict("Order is not open to start picking");
  await ensureAllocated(db, {
    organizationId,
    warehouseId: order.warehouseId,
    orderId: order.id,
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: remainingToPick(asPickLine(line)),
    })),
  });
  await db.update(schema.orders).set({ status: "picking" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pick", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: IncomingPick[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPickOrder(order.status)) conflict("Order is not open for picking");
  if (!hasUnpicked(order.lines.map(asPickLine))) conflict("Order has nothing remaining to pick");
  await getOrgLocation(db, organizationId, locationId);
  const allocations = await ensureAllocated(db, {
    organizationId,
    warehouseId: order.warehouseId,
    orderId: order.id,
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: remainingToPick(asPickLine(line)),
    })),
  });

  const incoming = resolveIncoming(order.lines, body.lines).filter((line) => line.qty > 0);
  let applied;
  try {
    applied = applyPartialPick(
      order.lines.map(asPickLine),
      incoming.map((line) => ({ lineId: line.lineId, qty: line.qty })),
    );
  } catch (err) {
    if (err instanceof OverPickError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid pick");
  }

  const postedByLine = new Map(applied.posted.map((row) => [row.lineId, row.qty]));
  const traceByLine = new Map(incoming.map((row) => [row.lineId, row]));
  const pickLines = order.lines
    .filter((line) => (postedByLine.get(line.id) ?? 0) > 0)
    .map((line) => {
      const trace = traceByLine.get(line.id);
      return {
        lineId: line.id,
        itemId: line.itemId,
        sku: line.sku,
        qty: postedByLine.get(line.id)!,
        lotCode: trace?.lotCode,
        serials: trace?.serials.length ? trace.serials : null,
        weightGrams: trace?.weightGrams ?? null,
      };
    });

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    pickLines.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    pickLines.map(
      (line) => (balances) =>
        planPick({
          itemId: line.itemId,
          sku: line.sku,
          locationId,
          qty: line.qty,
          refId: order.id,
          balances,
          lotCode: line.lotCode,
          serials: line.serials,
          weightGrams: line.weightGrams,
          clientId: order.clientId,
        }),
    ),
  );

  const now = Date.now();
  const fully = isFullyPicked(applied.next);
  const qtyPickedByLine = new Map(applied.next.map((line) => [line.lineId, line.qtyPicked]));
  const consumeExtras = pickLines.flatMap((line) =>
    consumeAllocationStatements(db, allocations, line.lineId, locationId, line.qty, now),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      ...order.lines.map((line) =>
        db
          .update(schema.orderLines)
          .set({ qtyPicked: qtyPickedByLine.get(line.id) ?? line.qtyPicked })
          .where(eq(schema.orderLines.id, line.id)),
      ),
      db
        .update(schema.orders)
        .set({
          status: fully ? "picked" : "picking",
          pickLocationId: locationId,
          pickedAt: fully ? now : order.pickedAt,
        })
        .where(eq(schema.orders.id, order.id)),
      ...consumeExtras,
    ],
  });

  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pack", async (c) => {
  const body = await c.req
    .json<{ lines?: { lineId?: string; itemId?: string; qty?: number }[] }>()
    .catch(() => ({}) as { lines?: { lineId?: string; itemId?: string; qty?: number }[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPackOrder(order.status)) conflict("Order must be picked before packing");
  if (!hasUnpacked(order.lines.map(asPackLine))) conflict("Order has nothing remaining to pack");

  const incoming = resolveIncomingPack(order.lines, body.lines).filter((line) => line.qty > 0);
  let applied;
  try {
    applied = applyPartialPack(order.lines.map(asPackLine), incoming);
  } catch (err) {
    if (err instanceof OverPackError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid pack");
  }

  const now = Date.now();
  const fully = isFullyPacked(applied.next);
  const qtyPackedByLine = new Map(applied.next.map((line) => [line.lineId, line.qtyPacked]));

  await db.batch([
    db
      .update(schema.orders)
      .set({
        status: fully ? "packed" : "packing",
        packedAt: fully ? now : order.packedAt,
      })
      .where(eq(schema.orders.id, order.id)),
    ...order.lines.map((line) =>
      db
        .update(schema.orderLines)
        .set({ qtyPacked: qtyPackedByLine.get(line.id) ?? line.qtyPacked })
        .where(eq(schema.orderLines.id, line.id)),
    ),
  ]);

  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/start-pack", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPack(order.status)) conflict("Order must be picked before packing");
  await db.update(schema.orders).set({ status: "packing" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.get("/orders/:id/label", async (c) => {
  const order = await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id"), { suggest: false });
  return c.json(buildShippingLabel(order));
});

ordersRoute.post("/orders/:id/label", async (c) => {
  const body = await c.req
    .json<{
      trackingNumber?: string;
      trackingCompany?: string;
      trackingUrl?: string;
      carrierService?: string;
      shipToAddress?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          trackingNumber?: string;
          trackingCompany?: string;
          trackingUrl?: string;
          carrierService?: string;
          shipToAddress?: string;
        },
    );
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const status = order.status === "draft" ? "open" : order.status;
  if (status === "cancelled") conflict("Cancelled orders cannot take a label");
  const carrierService = body.carrierService?.trim() || order.carrierService || "rackline_ground";
  if (!isCarrierService(carrierService)) badRequest("Unknown carrier service");
  const carrier = resolveCarrier(carrierService);
  const shipToAddress = body.shipToAddress?.trim() || order.shipToAddress;
  const label = buildShippingLabel({
    ...order,
    shipToAddress,
    trackingNumber: body.trackingNumber?.trim() || order.trackingNumber,
    trackingCompany: body.trackingCompany?.trim() || order.trackingCompany || carrier.company,
    trackingUrl: body.trackingUrl?.trim() || order.trackingUrl,
    carrierService,
  });
  await db
    .update(schema.orders)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      shipToAddress: label.shipToAddress,
    })
    .where(eq(schema.orders.id, order.id));
  return c.json(buildShippingLabel(await orderWithLines(db, organizationId, order.id, { suggest: false })));
});

ordersRoute.post("/orders/:id/ship", async (c) => {
  const body = await c.req.json<{
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    carrierService?: string;
    shipToAddress?: string;
  }>().catch(() => ({} as {
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    carrierService?: string;
    shipToAddress?: string;
  }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canShipOrder(order.status)) conflict("Order must be packed before shipping");
  const locationId = order.pickLocationId;
  if (!locationId) conflict("Pick location missing");

  const pickWeights = await db
    .select({
      itemId: schema.inventoryMovements.itemId,
      weightGrams: schema.inventoryMovements.weightGrams,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.refId, order.id),
        eq(schema.inventoryMovements.type, "pick"),
      ),
    );
  const weightByItem = new Map<string, number>();
  for (const row of pickWeights) {
    if (row.weightGrams == null) continue;
    weightByItem.set(row.itemId, (weightByItem.get(row.itemId) ?? 0) + row.weightGrams);
  }

  const movements: MovementDraft[] = order.lines.map((line) => {
    const weightGrams = line.catchWeight ? lineCatchWeight(true, line.sku, weightByItem.get(line.itemId)) : null;
    return {
      type: "ship",
      itemId: line.itemId,
      qty: line.qty,
      fromLocationId: locationId,
      refType: "order",
      refId: order.id,
      weightGrams,
      clientId: order.clientId,
    };
  });
  const plan: StockPlan = { balances: new Map(), movements };
  const now = Date.now();
  const carrierService = body.carrierService?.trim() || order.carrierService || "rackline_ground";
  if (!isCarrierService(carrierService)) badRequest("Unknown carrier service");
  const label = buildShippingLabel({
    ...order,
    shipToAddress: body.shipToAddress?.trim() || order.shipToAddress,
    trackingNumber: body.trackingNumber?.trim() || order.trackingNumber,
    trackingCompany: body.trackingCompany?.trim() || order.trackingCompany,
    trackingUrl: body.trackingUrl?.trim() || order.trackingUrl,
    carrierService,
  });
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded: new Map(),
    plan,
    extra: [
      db
        .update(schema.orders)
        .set({
          status: "shipped",
          shippedAt: now,
          trackingNumber: label.trackingNumber,
          trackingCompany: label.carrierCompany,
          trackingUrl: label.trackingUrl,
          carrierService: label.carrierServiceId,
          shipToAddress: label.shipToAddress,
          shopifySyncStatus: order.source === "shopify" ? "pending_fulfill" : order.shopifySyncStatus,
        })
        .where(eq(schema.orders.id, order.id)),
      ...releaseAllocationStatements(db, order.id, now),
    ],
  });

  let shopify;
  if (order.source === "shopify") {
    shopify = await fulfillShopifyOrder(db, organizationId, order.id);
  }
  return c.json({ ...(await orderWithLines(db, organizationId, order.id)), shopify });
});

ordersRoute.post("/orders/:id/unpick", async (c) => {
  const body = await c.req
    .json<{
      locationId?: string;
      lines?: { lineId?: string; itemId?: string; qty?: number }[];
    }>()
    .catch(() => ({}) as { locationId?: string; lines?: { lineId?: string; itemId?: string; qty?: number }[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canUnpickOrder(order.status)) conflict("Order cannot be unpicked");
  const unpickLines = order.lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    qtyPicked: line.qtyPicked,
    qtyPacked: line.qtyPacked,
  }));
  if (!unpickLines.some((line) => remainingToUnpick(line) > 0)) conflict("Order has nothing remaining to unpick");
  if (body.locationId) await getOrgLocation(db, organizationId, body.locationId);

  const incoming = resolveIncomingUnpick(order.lines, body.lines).filter((line) => line.qty > 0);
  try {
    await persistUnpick({
      db,
      organizationId,
      createdBy: user.id,
      warehouseId: order.warehouseId,
      orderId: order.id,
      pickLocationId: order.pickLocationId,
      lines: order.lines,
      incoming,
      locationId: body.locationId || null,
      restoreAllocations: true,
    });
  } catch (err) {
    if (err instanceof OverUnpickError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid unpick");
  }
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/cancel", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canCancelOrder(order.status)) conflict("Order cannot be cancelled");
  const cancelled = await cancelOrderDocument(db, {
    organizationId,
    orderId: order.id,
    createdBy: user.id,
  });
  if (!cancelled) conflict("Order cannot be cancelled");
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/shopify/fulfill", async (c) => {
  const result = await fulfillShopifyOrder(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  const order = await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  return c.json({ ...order, shopify: result }, result.status === "failed" ? 409 : 200);
});
