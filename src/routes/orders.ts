import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, optionalInt, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planPick, type MovementDraft, type StockPlan } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { fulfillShopifyOrder } from "../domain/shopify-fulfill";
import { canPackOrder, canPickOrder, canShipOrder, canStartPack, canStartPick, canCancelOrder, canUnpickOrder } from "../domain/status";
import { destPatchFromAddress } from "../domain/geo";
import { buildShippingLabel } from "../domain/shipping-label";
import {
  canVoidLabel,
  enabledServicesFromConnections,
  quoteRates,
  resolveLabelPurchase,
} from "../domain/carriers";
import { isLiveAggregator, requireLiveShipAddress, resolveParcel } from "../domain/carrier-live";
import {
  asCarrierLiveError,
  buyAggregatorLabel,
  shopAggregatorRates,
  voidAggregatorLabel,
} from "../lib/carrier-client";
import { loadCarrierConnections, recordCarrierEvent } from "./carriers";
import { scheduleShopifySellableSync } from "../db/shopify-sellable";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { canRelabelException } from "../domain/tracker";
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
  applyCarton,
  cartonNumber,
  cartonShipGate,
  orderLevelLabelGate,
  OverCartonError,
} from "../domain/cartons";
import { asCartonLines, loadPackagesForOrders, orderPatchFromPackages, withCartonRemaining } from "../db/packages";
import {
  consumeAllocationStatements,
  ensureAllocated,
  loadAtpBaysByItem,
  loadOpenAllocations,
  releaseAllocationStatements,
} from "../db/allocations";
import type { OpenAllocation } from "../domain/allocations";
import { cancelOrderDocument, persistUnpick, remainingToUnpick } from "../db/unpick";
import { OverUnpickError } from "../domain/partial-unpick";
import { resolveLineStockQty, UomConversionError } from "../domain/uom";
import { orderJobInput, guardFloorJob, syncDocumentJob } from "../db/jobs";
import { desiredVerb } from "../domain/jobs";

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
  barcode: schema.items.barcode,
  trackLot: schema.items.trackLot,
  trackSerial: schema.items.trackSerial,
  catchWeight: schema.items.catchWeight,
  trackExpiry: schema.items.trackExpiry,
  stockUom: schema.items.stockUom,
  altUom: schema.items.altUom,
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
  const packagesByOrder = await loadPackagesForOrders(db, [order.id]);
  const packages = packagesByOrder.get(order.id) ?? [];
  return {
    ...order,
    allocatedUnits: allocatedUnits(allocations),
    allocations,
    packages,
    lines: withCartonRemaining(withAllocations(decorated, allocations), packages),
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
  const packagesByOrder = await loadPackagesForOrders(
    db,
    rows.map((row) => row.id),
  );
  return c.json(
    rows.map((row) => {
      const reserved = allocsByOrder.get(row.id) ?? [];
      const packages = packagesByOrder.get(row.id) ?? [];
      return {
        ...row,
        allocatedUnits: allocatedUnits(reserved),
        allocations: reserved,
        packages,
        lines: withCartonRemaining(withAllocations((byOrder.get(row.id) ?? []).map(withRemaining), reserved), packages),
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
      clientId: body.clientId || null,
      ...destPatchFromAddress(body.shipToAddress),
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  const created = await orderWithLines(db, organizationId, id);
  await syncDocumentJob(db, orderJobInput(created));
  await scheduleShopifySellableSync(
    db,
    organizationId,
    lines.map((line) => line.itemId),
  );
  return c.json(created, 201);
});

ordersRoute.post("/orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPick(order.status)) conflict("Order is not open to start picking");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "pick",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    dueAt: order.source === "shopify" ? order.createdAt : null,
    createdAt: order.createdAt,
  });
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
  const started = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(started));
  return c.json(started);
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
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "pick",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: locationId,
    dueAt: order.source === "shopify" ? order.createdAt : null,
    createdAt: order.createdAt,
  });
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

  const picked = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(picked));
  return c.json(picked);
});

ordersRoute.post("/orders/:id/pack", async (c) => {
  const body = await c.req
    .json<{ lines?: { lineId?: string; itemId?: string; qty?: number }[] }>()
    .catch(() => ({}) as { lines?: { lineId?: string; itemId?: string; qty?: number }[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPackOrder(order.status)) conflict("Order must be picked before packing");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "pack",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    createdAt: order.createdAt,
  });
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
  const user = c.get("user")!;
  const packLines = incoming
    .map((line) => {
      const orderLine = order.lines.find((row) => row.id === line.lineId);
      return { itemId: orderLine?.itemId ?? "", qty: line.qty };
    })
    .filter((line) => line.itemId && line.qty > 0);

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
    ...packLines.map((line) =>
      db.insert(schema.packEvents).values({
        id: newId(),
        organizationId,
        warehouseId: order.warehouseId,
        userId: user.id,
        orderId: order.id,
        itemId: line.itemId,
        qty: line.qty,
        createdAt: now,
      }),
    ),
  ]);

  const packed = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(packed));
  return c.json(packed);
});

ordersRoute.post("/orders/:id/start-pack", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPack(order.status)) conflict("Order must be picked before packing");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "pack",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    createdAt: order.createdAt,
  });
  await db.update(schema.orders).set({ status: "packing" }).where(eq(schema.orders.id, order.id));
  const packing = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(packing));
  return c.json(packing);
});

function resolveIncomingCarton(
  lines: { id: string; itemId: string; cartonRemaining: number }[],
  bodyLines?: { lineId?: string; itemId?: string; qty?: number }[],
): { lineId: string; qty: number }[] {
  if (Array.isArray(bodyLines) && bodyLines.length > 0) {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const byItem = new Map(lines.map((line) => [line.itemId, line]));
    return bodyLines.map((row) => {
      const line =
        (row.lineId ? byId.get(row.lineId) : undefined) ?? (row.itemId ? byItem.get(row.itemId) : undefined);
      if (!line) badRequest("Line is not on this order");
      const qty = row.qty === undefined || row.qty === null ? line.cartonRemaining : requireInt(row.qty, "qty");
      return { lineId: line.id, qty };
    });
  }
  return lines.filter((line) => line.cartonRemaining > 0).map((line) => ({ lineId: line.id, qty: line.cartonRemaining }));
}

ordersRoute.post("/orders/:id/packages", async (c) => {
  const body = await c.req
    .json<{
      lines?: { lineId?: string; itemId?: string; qty?: number }[];
      pack?: boolean;
      weightOz?: number;
      lengthIn?: number;
      widthIn?: number;
      heightIn?: number;
    }>()
    .catch(
      () =>
        ({}) as {
          lines?: { lineId?: string; itemId?: string; qty?: number }[];
          pack?: boolean;
          weightOz?: number;
          lengthIn?: number;
          widthIn?: number;
          heightIn?: number;
        },
    );
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPackOrder(order.status) && order.status !== "packed") {
    conflict("Order must be picked before packing cartons");
  }
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "pack",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    createdAt: order.createdAt,
  });

  if (body.pack) {
    if (!canPackOrder(order.status)) conflict("Order must be picked before packing");
    if (!hasUnpacked(order.lines.map(asPackLine)) && !order.lines.some((line) => (line.cartonRemaining ?? 0) > 0)) {
      conflict("Order has nothing remaining to pack");
    }
    if (hasUnpacked(order.lines.map(asPackLine))) {
      const incomingPack = resolveIncomingPack(order.lines, body.lines).filter((line) => line.qty > 0);
      let packed;
      try {
        packed = applyPartialPack(order.lines.map(asPackLine), incomingPack);
      } catch (err) {
        if (err instanceof OverPackError) throw err;
        badRequest(err instanceof Error ? err.message : "Invalid pack");
      }
      const nowPack = Date.now();
      const fullyPacked = isFullyPacked(packed.next);
      const qtyPackedByLine = new Map(packed.next.map((line) => [line.lineId, line.qtyPacked]));
      const packLines = incomingPack
        .map((line) => {
          const orderLine = order.lines.find((row) => row.id === line.lineId);
          return { itemId: orderLine?.itemId ?? "", qty: line.qty };
        })
        .filter((line) => line.itemId && line.qty > 0);
      await db.batch([
        db
          .update(schema.orders)
          .set({
            status: fullyPacked ? "packed" : "packing",
            packedAt: fullyPacked ? nowPack : order.packedAt,
          })
          .where(eq(schema.orders.id, order.id)),
        ...order.lines.map((line) =>
          db
            .update(schema.orderLines)
            .set({ qtyPacked: qtyPackedByLine.get(line.id) ?? line.qtyPacked })
            .where(eq(schema.orderLines.id, line.id)),
        ),
        ...packLines.map((line) =>
          db.insert(schema.packEvents).values({
            id: newId(),
            organizationId,
            warehouseId: order.warehouseId,
            userId: user.id,
            orderId: order.id,
            itemId: line.itemId,
            qty: line.qty,
            createdAt: nowPack,
          }),
        ),
      ]);
      order = await orderWithLines(db, organizationId, order.id, { suggest: false });
    }
  }

  const incoming = resolveIncomingCarton(order.lines, body.pack ? undefined : body.lines).filter((line) => line.qty > 0);
  let applied;
  try {
    applied = applyCarton(asCartonLines(order.lines, order.packages), incoming);
  } catch (err) {
    if (err instanceof OverCartonError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid carton");
  }

  const parcel = resolveParcel({
    weightOz: optionalInt(body.weightOz, "weightOz"),
    lengthIn: optionalInt(body.lengthIn, "lengthIn"),
    widthIn: optionalInt(body.widthIn, "widthIn"),
    heightIn: optionalInt(body.heightIn, "heightIn"),
  });
  const seq = order.packages.length + 1;
  const packageId = newId();
  const now = Date.now();
  await db.batch([
    db.insert(schema.orderPackages).values({
      id: packageId,
      organizationId,
      orderId: order.id,
      number: cartonNumber(seq),
      seq,
      weightOz: parcel.weightOz,
      lengthIn: parcel.lengthIn,
      widthIn: parcel.widthIn,
      heightIn: parcel.heightIn,
      labelStatus: "none",
      createdAt: now,
    }),
    ...applied.posted.map((line) => {
      const orderLine = order.lines.find((row) => row.id === line.lineId)!;
      return db.insert(schema.orderPackageLines).values({
        id: newId(),
        packageId,
        orderLineId: line.lineId,
        itemId: orderLine.itemId,
        qty: line.qty,
      });
    }),
  ]);
  const next = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(next));
  return c.json(next, 201);
});

ordersRoute.get("/orders/:id/packages/:pkgId/label", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  if (!pkg.trackingNumber) conflict("Buy a label before printing", "NEED_PACKAGE");
  const warehouse = await loadWarehouse(db, organizationId, order.warehouseId);
  return c.json(
    buildShippingLabel({
      ...order,
      trackingNumber: pkg.trackingNumber,
      trackingCompany: pkg.trackingCompany,
      trackingUrl: pkg.trackingUrl,
      carrierService: pkg.carrierService,
      carrierConnectionId: pkg.carrierConnectionId,
      labelStatus: pkg.labelStatus,
      packageNumber: pkg.number,
      shipFromAddress: warehouse?.shipFromAddress ?? null,
    }),
  );
});

ordersRoute.post("/orders/:id/packages/:pkgId/label", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  const status = order.status === "draft" ? "open" : order.status;
  if (status === "cancelled") conflict("Cancelled orders cannot take a label");
  const { label, purchase, parcel, liveLabel, connection } = await purchaseOrderLabel(db, organizationId, order, body, pkg);
  const live = Boolean(liveLabel);
  const trackerStatus = live ? "pre_transit" : pkg.trackerStatus;
  await db
    .update(schema.orderPackages)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      carrierConnectionId: purchase.connectionId,
      labelStatus: "purchased",
      carrierShipmentId: liveLabel?.shipmentId ?? pkg.carrierShipmentId,
      carrierLabelId: liveLabel?.labelId ?? pkg.carrierLabelId,
      postageCents: liveLabel?.postageCents ?? pkg.postageCents,
      weightOz: parcel.weightOz,
      lengthIn: parcel.lengthIn,
      widthIn: parcel.widthIn,
      heightIn: parcel.heightIn,
      trackerStatus,
      trackerUpdatedAt: live ? Date.now() : pkg.trackerUpdatedAt,
    })
    .where(eq(schema.orderPackages.id, pkg.id));
  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
  const patch = orderPatchFromPackages(packages);
  if (patch) {
    await db
      .update(schema.orders)
      .set({
        ...patch,
        ...destPatchFromAddress(label.shipToAddress),
      })
      .where(eq(schema.orders.id, order.id));
  }
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: purchase.connectionId,
    orderId: order.id,
    kind: "buy",
    status: "ok",
    request: {
      carrierService: purchase.service.id,
      connectionId: purchase.connectionId,
      mode: live ? "live" : connection?.mode ?? "demo",
      parcel,
      packageId: pkg.id,
      packageNumber: pkg.number,
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      message: live
        ? "Postage purchased from the aggregator."
        : "Label minted locally. Direct carrier APIs are not called — connect EasyPost or ShipEngine for live postage.",
    },
  });
  const next = await orderWithLines(db, organizationId, order.id, { suggest: false });
  const warehouse = await loadWarehouse(db, organizationId, next.warehouseId);
  return c.json(
    buildShippingLabel({
      ...next,
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      packageNumber: pkg.number,
      shipFromAddress: warehouse?.shipFromAddress ?? null,
    }),
  );
});

ordersRoute.post("/orders/:id/packages/:pkgId/label/void", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  const decision = canVoidLabel({ status: order.status, labelStatus: pkg.labelStatus });
  if (!decision.ok) {
    if (decision.code === "SHIPPED" || decision.code === "CANCELLED") conflict(decision.error);
    badRequest(decision.error);
  }
  const connections = await loadCarrierConnections(db, organizationId);
  const connection = connections.find((row) => row.id === pkg.carrierConnectionId) ?? null;
  if (connection && isLiveAggregator(connection.provider, connection.mode) && (pkg.carrierShipmentId || pkg.carrierLabelId)) {
    if (!connection.apiKey) conflict("Live void needs an API key", "CARRIER_LIVE");
    try {
      await voidAggregatorLabel({
        provider: connection.provider as "easypost" | "shipengine",
        apiKey: connection.apiKey,
        shipmentId: pkg.carrierShipmentId,
        labelId: pkg.carrierLabelId,
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: pkg.carrierConnectionId,
        orderId: order.id,
        kind: "void",
        status: "failed",
        request: { trackingNumber: pkg.trackingNumber, carrierService: pkg.carrierService, mode: "live", packageId: pkg.id },
        response: { error: err instanceof Error ? err.message : "Void failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
  await db
    .update(schema.orderPackages)
    .set({
      trackingNumber: null,
      trackingUrl: null,
      labelStatus: "voided",
      carrierShipmentId: null,
      carrierLabelId: null,
      postageCents: null,
      trackerStatus: null,
      trackerUpdatedAt: null,
    })
    .where(eq(schema.orderPackages.id, pkg.id));
  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
  const patch = orderPatchFromPackages(packages);
  if (patch) {
    await db.update(schema.orders).set(patch).where(eq(schema.orders.id, order.id));
  }
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: pkg.carrierConnectionId,
    orderId: order.id,
    kind: "void",
    status: "ok",
    request: { trackingNumber: pkg.trackingNumber, carrierService: pkg.carrierService, packageId: pkg.id },
    response: { voided: true, live: Boolean(connection && isLiveAggregator(connection.provider, connection.mode)) },
  });
  return c.json(await orderWithLines(db, organizationId, order.id, { suggest: false }));
});

ordersRoute.post("/orders/:id/packages/:pkgId/relabel", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  const decision = canRelabelException({
    status: order.status,
    trackerStatus: pkg.trackerStatus,
    labelStatus: pkg.labelStatus,
    trackingNumber: pkg.trackingNumber,
  });
  if (!decision.ok) {
    if (decision.code === "CANCELLED") conflict(decision.error);
    conflict(decision.error, decision.code);
  }
  await tryVoidOldAggregatorLabel(db, organizationId, {
    orderId: order.id,
    connectionId: pkg.carrierConnectionId,
    carrierShipmentId: pkg.carrierShipmentId,
    carrierLabelId: pkg.carrierLabelId,
    trackingNumber: pkg.trackingNumber,
    carrierService: pkg.carrierService,
    packageId: pkg.id,
  });
  const { label, purchase, parcel, liveLabel, connection } = await purchaseOrderLabel(
    db,
    organizationId,
    order,
    { ...body, trackingNumber: undefined },
    pkg,
    { forceNewTracking: true },
  );
  const now = Date.now();
  await db
    .update(schema.orderPackages)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      carrierConnectionId: purchase.connectionId,
      labelStatus: "purchased",
      carrierShipmentId: liveLabel?.shipmentId ?? null,
      carrierLabelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      weightOz: parcel.weightOz,
      lengthIn: parcel.lengthIn,
      widthIn: parcel.widthIn,
      heightIn: parcel.heightIn,
      trackerStatus: "pre_transit",
      trackerUpdatedAt: now,
    })
    .where(eq(schema.orderPackages.id, pkg.id));
  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
  const patch = orderPatchFromPackages(packages);
  if (patch) {
    await db
      .update(schema.orders)
      .set({
        ...patch,
        ...destPatchFromAddress(label.shipToAddress),
        trackerUpdatedAt: now,
      })
      .where(eq(schema.orders.id, order.id));
  }
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: purchase.connectionId,
    orderId: order.id,
    kind: "buy",
    status: "ok",
    request: {
      carrierService: purchase.service.id,
      connectionId: purchase.connectionId,
      mode: liveLabel ? "live" : connection?.mode ?? "demo",
      parcel,
      packageId: pkg.id,
      packageNumber: pkg.number,
      relabel: true,
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      previousTrackingNumber: pkg.trackingNumber,
      message: liveLabel
        ? "Replacement postage purchased from the aggregator."
        : "Replacement label minted locally. Direct carrier APIs are not called — connect EasyPost or ShipEngine for live postage.",
    },
  });
  const next = await orderWithLines(db, organizationId, order.id, { suggest: false });
  const warehouse = await loadWarehouse(db, organizationId, next.warehouseId);
  return c.json(
    buildShippingLabel({
      ...next,
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      packageNumber: pkg.number,
      shipFromAddress: warehouse?.shipFromAddress ?? null,
    }),
  );
});

async function loadWarehouse(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  warehouseId: string,
) {
  const [row] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

type LabelBody = {
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  carrierService?: string;
  carrierConnectionId?: string;
  shipToAddress?: string;
  liveRateId?: string;
  weightOz?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
};

function parcelFrom(
  body: LabelBody,
  source: {
    packageWeightOz?: number | null;
    packageLengthIn?: number | null;
    packageWidthIn?: number | null;
    packageHeightIn?: number | null;
    weightOz?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
  },
) {
  return resolveParcel({
    weightOz: optionalInt(body.weightOz, "weightOz") ?? source.packageWeightOz ?? source.weightOz ?? undefined,
    lengthIn: optionalInt(body.lengthIn, "lengthIn") ?? source.packageLengthIn ?? source.lengthIn ?? undefined,
    widthIn: optionalInt(body.widthIn, "widthIn") ?? source.packageWidthIn ?? source.widthIn ?? undefined,
    heightIn: optionalInt(body.heightIn, "heightIn") ?? source.packageHeightIn ?? source.heightIn ?? undefined,
  });
}

function parcelPatch(parcel: ReturnType<typeof resolveParcel>) {
  return {
    packageWeightOz: parcel.weightOz,
    packageLengthIn: parcel.lengthIn,
    packageWidthIn: parcel.widthIn,
    packageHeightIn: parcel.heightIn,
  };
}

async function purchaseOrderLabel(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  order: Awaited<ReturnType<typeof orderWithLines>>,
  body: LabelBody,
  pkg?: {
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    trackingUrl?: string | null;
    weightOz?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
  },
  options?: { forceNewTracking?: boolean },
) {
  const connections = await loadCarrierConnections(db, organizationId);
  const purchase = resolveLabelPurchase({
    connections,
    serviceId: body.carrierService?.trim() || order.carrierService,
    connectionId: body.carrierConnectionId?.trim() || order.carrierConnectionId,
  });
  if (!purchase.ok) badRequest(purchase.error);
  const warehouse = await loadWarehouse(db, organizationId, order.warehouseId);
  const shipFromAddress = warehouse?.shipFromAddress ?? null;
  const shipToAddress = body.shipToAddress?.trim() || order.shipToAddress;
  const parcel = parcelFrom(body, pkg ?? order);
  const connection = connections.find((row) => row.id === purchase.connectionId) ?? null;
  const explicitTracking = body.trackingNumber?.trim();
  const live =
    !explicitTracking &&
    connection &&
    isLiveAggregator(connection.provider, connection.mode);
  let liveLabel = null;
  if (live) {
    if (!connection.apiKey) badRequest("Live EasyPost / ShipEngine needs an API key");
    const services = enabledServicesFromConnections([connection]).filter((row) => row.connectionId === connection.id);
    try {
      liveLabel = await buyAggregatorLabel({
        provider: connection.provider as "easypost" | "shipengine",
        apiKey: connection.apiKey,
        services,
        serviceId: purchase.service.id,
        shipFrom: requireLiveShipAddress({
          name: warehouse?.name || "Warehouse",
          text: shipFromAddress,
          city: warehouse?.city,
          region: warehouse?.region,
          country: warehouse?.country,
        }),
        shipTo: requireLiveShipAddress({
          name: order.customerName,
          text: shipToAddress,
          city: order.shipToCity,
          region: order.shipToRegion,
          country: order.shipToCountry,
        }),
        parcel,
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: purchase.connectionId,
        orderId: order.id,
        kind: "buy",
        status: "failed",
        request: { carrierService: purchase.service.id, connectionId: purchase.connectionId, mode: "live", parcel },
        response: { error: err instanceof Error ? err.message : "Buy failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
  const existingTracking = options?.forceNewTracking ? null : pkg ? pkg.trackingNumber : order.trackingNumber;
  const existingUrl = options?.forceNewTracking ? null : pkg ? pkg.trackingUrl : order.trackingUrl;
  const existingCompany = pkg ? pkg.trackingCompany : order.trackingCompany;
  const label = buildShippingLabel({
    ...order,
    shipToAddress,
    shipFromAddress,
    trackingNumber: liveLabel?.trackingNumber || explicitTracking || existingTracking,
    trackingCompany: body.trackingCompany?.trim() || existingCompany || purchase.service.company,
    trackingUrl: liveLabel?.trackingUrl || body.trackingUrl?.trim() || existingUrl,
    carrierService: purchase.service.id,
    carrierConnectionId: purchase.connectionId,
    labelStatus: "purchased",
  });
  return { label, purchase, shipFromAddress, parcel, liveLabel, connection };
}

async function tryVoidOldAggregatorLabel(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  input: {
    orderId: string;
    connectionId?: string | null;
    carrierShipmentId?: string | null;
    carrierLabelId?: string | null;
    trackingNumber?: string | null;
    carrierService?: string | null;
    packageId?: string | null;
  },
): Promise<{ voided: boolean; error?: string }> {
  const connections = await loadCarrierConnections(db, organizationId);
  const connection = connections.find((row) => row.id === input.connectionId) ?? null;
  if (
    !connection ||
    !isLiveAggregator(connection.provider, connection.mode) ||
    !(input.carrierShipmentId || input.carrierLabelId)
  ) {
    return { voided: false };
  }
  if (!connection.apiKey) return { voided: false, error: "Live void needs an API key" };
  try {
    await voidAggregatorLabel({
      provider: connection.provider as "easypost" | "shipengine",
      apiKey: connection.apiKey,
      shipmentId: input.carrierShipmentId,
      labelId: input.carrierLabelId,
    });
    await recordCarrierEvent(db, {
      organizationId,
      connectionId: input.connectionId,
      orderId: input.orderId,
      kind: "void",
      status: "ok",
      request: {
        trackingNumber: input.trackingNumber,
        carrierService: input.carrierService,
        packageId: input.packageId,
        relabel: true,
      },
      response: { voided: true, live: true, relabel: true },
    });
    return { voided: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Void failed";
    await recordCarrierEvent(db, {
      organizationId,
      connectionId: input.connectionId,
      orderId: input.orderId,
      kind: "void",
      status: "failed",
      request: {
        trackingNumber: input.trackingNumber,
        carrierService: input.carrierService,
        mode: "live",
        packageId: input.packageId,
        relabel: true,
      },
      response: { error, relabel: true },
    });
    return { voided: false, error };
  }
}

ordersRoute.get("/orders/:id/label", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!order.trackingNumber) conflict("Buy a label before printing");
  const warehouse = await loadWarehouse(db, organizationId, order.warehouseId);
  return c.json(buildShippingLabel({ ...order, shipFromAddress: warehouse?.shipFromAddress ?? null }));
});

ordersRoute.post("/orders/:id/rates", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const connections = await loadCarrierConnections(db, organizationId);
  const services = enabledServicesFromConnections(connections);
  const warehouse = await loadWarehouse(db, organizationId, order.warehouseId);
  const shipFromAddress = warehouse?.shipFromAddress ?? null;
  const shipToAddress = body.shipToAddress?.trim() || order.shipToAddress;
  const parcel = parcelFrom(body, order);
  const liveConnections = connections.filter(
    (row) => isLiveAggregator(row.provider, row.mode) && Boolean(row.apiKey),
  );
  const liveIds = new Set(liveConnections.map((row) => row.id));
  const cannedServices = services.filter((row) => !row.connectionId || !liveIds.has(row.connectionId));
  const rates = quoteRates({
    services: cannedServices,
    shipFrom: shipFromAddress,
    shipTo: shipToAddress,
  });
  for (const connection of liveConnections) {
    const liveServices = services.filter((row) => row.connectionId === connection.id);
    if (liveServices.length === 0) continue;
    try {
      const shopped = await shopAggregatorRates({
        provider: connection.provider as "easypost" | "shipengine",
        apiKey: connection.apiKey!,
        services: liveServices,
        shipFrom: requireLiveShipAddress({
          name: warehouse?.name || "Warehouse",
          text: shipFromAddress,
          city: warehouse?.city,
          region: warehouse?.region,
          country: warehouse?.country,
        }),
        shipTo: requireLiveShipAddress({
          name: order.customerName,
          text: shipToAddress,
          city: order.shipToCity,
          region: order.shipToRegion,
          country: order.shipToCountry,
        }),
        parcel,
      });
      rates.push(...shopped.rates);
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: connection.id,
        orderId: order.id,
        kind: "rates",
        status: "ok",
        request: { orderId: order.id, shipFromAddress, shipToAddress, parcel, mode: "live" },
        response: { rates: shopped.rates, shipmentId: shopped.shipmentId ?? null },
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: connection.id,
        orderId: order.id,
        kind: "rates",
        status: "failed",
        request: { orderId: order.id, shipFromAddress, shipToAddress, parcel, mode: "live" },
        response: { error: err instanceof Error ? err.message : "Rates failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
  const defaultConnection = connections.find((row) => row.isDefault) ?? connections[0];
  if (liveConnections.length === 0) {
    await recordCarrierEvent(db, {
      organizationId,
      connectionId: defaultConnection?.id ?? null,
      orderId: order.id,
      kind: "rates",
      status: "ok",
      request: { orderId: order.id, shipFromAddress, shipToAddress, parcel, mode: "demo" },
      response: { rates },
    });
  }
  return c.json({ rates, shipFromAddress, shipToAddress, parcel });
});

ordersRoute.post("/orders/:id/label", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const status = order.status === "draft" ? "open" : order.status;
  if (status === "cancelled") conflict("Cancelled orders cannot take a label");
  const packageGate = orderLevelLabelGate(order.packages.length);
  if (!packageGate.ok) conflict(packageGate.error, packageGate.code);
  const { label, purchase, parcel, liveLabel, connection } = await purchaseOrderLabel(db, organizationId, order, body);
  const live = Boolean(liveLabel);
  await db
    .update(schema.orders)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      carrierConnectionId: purchase.connectionId,
      labelStatus: "purchased",
      carrierShipmentId: liveLabel?.shipmentId ?? order.carrierShipmentId,
      carrierLabelId: liveLabel?.labelId ?? order.carrierLabelId,
      postageCents: liveLabel?.postageCents ?? order.postageCents,
      trackerStatus: live ? "pre_transit" : order.trackerStatus,
      trackerUpdatedAt: live ? Date.now() : order.trackerUpdatedAt,
      ...parcelPatch(parcel),
      ...destPatchFromAddress(label.shipToAddress),
    })
    .where(eq(schema.orders.id, order.id));
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: purchase.connectionId,
    orderId: order.id,
    kind: "buy",
    status: "ok",
    request: {
      carrierService: purchase.service.id,
      connectionId: purchase.connectionId,
      mode: live ? "live" : connection?.mode ?? "demo",
      parcel,
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      message: live
        ? "Postage purchased from the aggregator."
        : "Label minted locally. Direct carrier APIs are not called — connect EasyPost or ShipEngine for live postage.",
    },
  });
  const next = await orderWithLines(db, organizationId, order.id, { suggest: false });
  const warehouse = await loadWarehouse(db, organizationId, next.warehouseId);
  return c.json(buildShippingLabel({ ...next, shipFromAddress: warehouse?.shipFromAddress ?? null }));
});

ordersRoute.post("/orders/:id/label/void", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const decision = canVoidLabel({ status: order.status, labelStatus: order.labelStatus });
  if (!decision.ok) {
    if (decision.code === "SHIPPED" || decision.code === "CANCELLED") conflict(decision.error);
    badRequest(decision.error);
  }
  const connections = await loadCarrierConnections(db, organizationId);
  const connection = connections.find((row) => row.id === order.carrierConnectionId) ?? null;
  if (connection && isLiveAggregator(connection.provider, connection.mode) && (order.carrierShipmentId || order.carrierLabelId)) {
    if (!connection.apiKey) conflict("Live void needs an API key", "CARRIER_LIVE");
    try {
      await voidAggregatorLabel({
        provider: connection.provider as "easypost" | "shipengine",
        apiKey: connection.apiKey,
        shipmentId: order.carrierShipmentId,
        labelId: order.carrierLabelId,
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: order.carrierConnectionId,
        orderId: order.id,
        kind: "void",
        status: "failed",
        request: { trackingNumber: order.trackingNumber, carrierService: order.carrierService, mode: "live" },
        response: { error: err instanceof Error ? err.message : "Void failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
  await db
    .update(schema.orders)
    .set({
      trackingNumber: null,
      trackingUrl: null,
      labelStatus: "voided",
      carrierShipmentId: null,
      carrierLabelId: null,
      postageCents: null,
    })
    .where(eq(schema.orders.id, order.id));
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: order.carrierConnectionId,
    orderId: order.id,
    kind: "void",
    status: "ok",
    request: { trackingNumber: order.trackingNumber, carrierService: order.carrierService },
    response: { voided: true, live: Boolean(connection && isLiveAggregator(connection.provider, connection.mode)) },
  });
  return c.json(await orderWithLines(db, organizationId, order.id, { suggest: false }));
});

ordersRoute.post("/orders/:id/relabel", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const packageGate = orderLevelLabelGate(order.packages.length);
  if (!packageGate.ok) conflict(packageGate.error, packageGate.code);
  const decision = canRelabelException({
    status: order.status,
    trackerStatus: order.trackerStatus,
    labelStatus: order.labelStatus,
    trackingNumber: order.trackingNumber,
  });
  if (!decision.ok) {
    if (decision.code === "CANCELLED") conflict(decision.error);
    conflict(decision.error, decision.code);
  }
  await tryVoidOldAggregatorLabel(db, organizationId, {
    orderId: order.id,
    connectionId: order.carrierConnectionId,
    carrierShipmentId: order.carrierShipmentId,
    carrierLabelId: order.carrierLabelId,
    trackingNumber: order.trackingNumber,
    carrierService: order.carrierService,
  });
  const { label, purchase, parcel, liveLabel, connection } = await purchaseOrderLabel(
    db,
    organizationId,
    order,
    { ...body, trackingNumber: undefined },
    undefined,
    { forceNewTracking: true },
  );
  const now = Date.now();
  await db
    .update(schema.orders)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      carrierConnectionId: purchase.connectionId,
      labelStatus: "purchased",
      carrierShipmentId: liveLabel?.shipmentId ?? null,
      carrierLabelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      trackerStatus: "pre_transit",
      trackerUpdatedAt: now,
      ...parcelPatch(parcel),
      ...destPatchFromAddress(label.shipToAddress),
    })
    .where(eq(schema.orders.id, order.id));
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: purchase.connectionId,
    orderId: order.id,
    kind: "buy",
    status: "ok",
    request: {
      carrierService: purchase.service.id,
      connectionId: purchase.connectionId,
      mode: liveLabel ? "live" : connection?.mode ?? "demo",
      parcel,
      relabel: true,
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      previousTrackingNumber: order.trackingNumber,
      message: liveLabel
        ? "Replacement postage purchased from the aggregator."
        : "Replacement label minted locally. Direct carrier APIs are not called — connect EasyPost or ShipEngine for live postage.",
    },
  });
  const next = await orderWithLines(db, organizationId, order.id, { suggest: false });
  const warehouse = await loadWarehouse(db, organizationId, next.warehouseId);
  return c.json(buildShippingLabel({ ...next, shipFromAddress: warehouse?.shipFromAddress ?? null }));
});

ordersRoute.post("/orders/:id/ship", async (c) => {
  const body = await c.req.json<LabelBody>().catch(() => ({}) as LabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canShipOrder(order.status)) conflict("Order must be packed before shipping");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: order.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "order",
    refId: order.id,
    verb: "ship",
    number: order.number,
    title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
    fromLocationId: order.pickLocationId,
    createdAt: order.createdAt,
  });
  const locationId = order.pickLocationId;
  if (!locationId) conflict("Pick location missing");
  const packedUnits = order.lines.reduce((sum, line) => sum + line.qtyPacked, 0);
  const shipGate = cartonShipGate({
    packedUnits,
    packages: order.packages.map((row) => ({ units: row.units, trackingNumber: row.trackingNumber })),
  });
  if (!shipGate.ok) conflict(shipGate.error, shipGate.code);

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
  const usePackages = order.packages.length > 0;
  const purchased = usePackages
    ? {
        label: {
          trackingNumber: order.trackingNumber || order.packages.find((row) => row.trackingNumber)?.trackingNumber || "",
          carrierCompany: order.trackingCompany || order.packages.find((row) => row.trackingNumber)?.trackingCompany || "",
          trackingUrl: order.trackingUrl || order.packages.find((row) => row.trackingNumber)?.trackingUrl || "",
          carrierServiceId: order.carrierService || order.packages.find((row) => row.trackingNumber)?.carrierService || "rackline_ground",
          shipToAddress: order.shipToAddress,
        },
        purchase: { connectionId: order.carrierConnectionId },
        parcel: resolveParcel({
          weightOz: order.packageWeightOz ?? undefined,
          lengthIn: order.packageLengthIn ?? undefined,
          widthIn: order.packageWidthIn ?? undefined,
          heightIn: order.packageHeightIn ?? undefined,
        }),
        liveLabel: {
          shipmentId: order.carrierShipmentId,
          labelId: order.carrierLabelId,
          postageCents: order.postageCents,
        },
      }
    : await purchaseOrderLabel(db, organizationId, order, body);
  const { label, purchase, parcel, liveLabel } = purchased;
  const liveBuy = !usePackages && Boolean(liveLabel);
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
          carrierConnectionId: purchase.connectionId,
          labelStatus: "purchased",
          carrierShipmentId: liveLabel?.shipmentId ?? order.carrierShipmentId,
          carrierLabelId: liveLabel?.labelId ?? order.carrierLabelId,
          postageCents: liveLabel?.postageCents ?? order.postageCents,
          trackerStatus: liveBuy ? "pre_transit" : order.trackerStatus,
          trackerUpdatedAt: liveBuy ? now : order.trackerUpdatedAt,
          ...(!usePackages ? parcelPatch(parcel) : {}),
          ...destPatchFromAddress(label.shipToAddress),
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
  const shipped = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(shipped));
  return c.json({ ...shipped, shopify });
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
  const unpickVerb = desiredVerb("order", order.status);
  if (unpickVerb) {
    await guardFloorJob(db, {
      organizationId,
      warehouseId: order.warehouseId,
      userId: user.id,
      role: c.get("role")!,
      refType: "order",
      refId: order.id,
      verb: unpickVerb,
      number: order.number,
      title: order.source === "shopify" ? `${order.customerName} · Shopify` : order.customerName,
      fromLocationId: order.pickLocationId,
      createdAt: order.createdAt,
    });
  }
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
  const unpicked = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(unpicked));
  return c.json(unpicked);
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
  const cancelledOrder = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(cancelledOrder));
  await scheduleShopifySellableSync(
    db,
    organizationId,
    order.lines.map((line) => line.itemId),
  );
  return c.json(cancelledOrder);
});

ordersRoute.post("/orders/:id/shopify/fulfill", async (c) => {
  const result = await fulfillShopifyOrder(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  const order = await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  return c.json({ ...order, shopify: result }, result.status === "failed" ? 409 : 200);
});
