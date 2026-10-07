import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, badRequestFrom, conflict, notFound, optionalInt, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planPick, type MovementDraft, type StockPlan } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { fulfillShopifyOrder } from "../domain/shopify-fulfill";
import { fulfillChannelOrder } from "../db/channel-sync";
import { loadWorkflowPolicy } from "../db/workflow";
import { assertRecordedScans, assertScanned, requiresScan, type ScanCheckLine, type ScanEvidence } from "../domain/workflow-policy";
import { consumeItemScans, loadRecordedScans } from "../db/scan-sessions";
import { runIdempotent } from "../db/idempotency";
import { loadItemPacks } from "../db/item-packs";
import { postsTrackingBack } from "../domain/channels/adapter";
import { canPackOrder, canPickOrder, canShipOrder, canShipCartonOrder, canStartPack, canStartPick, canCancelOrder, canUnpickOrder } from "../domain/status";
import { destPatchFromAddress } from "../domain/geo";
import { buildShippingLabel } from "../domain/shipping-label";
import {
  canVoidLabel,
  enabledServicesFromConnections,
  quoteRates,
  resolveLabelPurchase,
} from "../domain/carriers";
import { isLivePostage, postagePurchaseMessage, requireLiveShipAddress, resolveParcel } from "../domain/carrier-live";
import { asCarrierLiveError } from "../lib/carrier-client";
import { buyLivePostage, shopLiveRates, voidLivePostage } from "../lib/live-postage";
import { customsForOrderLabel } from "../db/customs";
import { orderAddressVerdict } from "../db/address-checks";
import { AddressInvalidError } from "../domain/address-check";
import { loadCarrierConnections, recordCarrierEvent } from "./carriers";
import { scheduleShopifySellableSync } from "../db/shopify-sellable";
import { scheduleOrderCreated, scheduleOrderShipped } from "../db/outbound-webhooks";
import { parseSerialList } from "../domain/lots";
import { internationalLabelBlock, serialsFromScans } from "../domain/warranty";
import { assignPackedSerials, enqueueOrderPrepared, linkAssignmentsToPackage, stampShipmentWarranties } from "../db/warranty";
import type { RecordedScan } from "../domain/workflow-policy";
import { lineCatchWeight } from "../lib/catch-weight";
import { splitCatchWeight } from "../domain/catch-weight";
import { canRelabelException } from "../domain/tracker";
import { newPublicToken } from "../domain/public-token";
import { scheduleCustomerEmails } from "../db/customer-mail";
import {
  applyPartialPick,
  hasUnpicked,
  isFullyPicked,
  remainingToPick,
  suggestPickBay,
  OverPickError,
  type PickLine,
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
  canShipLabeledCarton,
  canUncartonOrderPackage,
  cartonNumber,
  cartonShipGate,
  isCartonShipComplete,
  nextCartonSeq,
  orderLevelLabelGate,
  OverCartonError,
} from "../domain/cartons";
import {
  asCartonLines,
  emptyOrderPackagePatch,
  loadPackagesForOrders,
  orderPatchFromPackages,
  withCartonRemaining,
  type OrderPackageRow,
} from "../db/packages";
import {
  consumeAllocationStatements,
  ensureAllocated,
  loadAtpBaysByItem,
  loadOpenAllocations,
  loadOpenSoftAllocations,
  releaseAllocationStatements,
  releaseSoftAllocationStatements,
  reserveOrderStock,
  type OpenSoftAllocation,
} from "../db/allocations";
import type { OpenAllocation } from "../domain/allocations";
import { cancelOrderDocument, loadNetPickSlices, persistUnpick, remainingToUnpick } from "../db/unpick";
import { drawFromPlate, normalizePlateCode, type PlateOp } from "../domain/license-plates";
import { plateForPick } from "../db/license-plates";
import { OverUnpickError } from "../domain/partial-unpick";
import { resolveLineStockQty, UomConversionError } from "../domain/uom";
import { ensureCustomer } from "../db/parties";
import { orderJobInput, guardFloorJob, syncDocumentJob } from "../db/jobs";
import { desiredVerb } from "../domain/jobs";
import { backorderNumber, ledgerUnpick, planShortShip, shopifyBackorderFields } from "../domain/short-ship";

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

function withAllocations<T extends { id: string; qty?: number; qtyPicked?: number }>(
  lines: T[],
  allocations: OpenAllocation[],
  soft: OpenSoftAllocation[] = [],
) {
  return lines.map((line) => {
    const reserved = allocations.filter((row) => row.orderLineId === line.id);
    const softQty = soft.filter((row) => row.orderLineId === line.id).reduce((sum, row) => sum + row.qty, 0);
    const allocatedQty = reserved.reduce((sum, row) => sum + row.qty, 0);
    const reservedQty = allocatedQty + softQty;
    const needed = Math.max(0, (line.qty ?? 0) - (line.qtyPicked ?? 0));
    return {
      ...line,
      allocatedQty,
      softReservedQty: softQty,
      reservedQty,
      shortQty: Math.max(0, needed - reservedQty),
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
  order: { id: string; clientId: string | null; warehouseId: string },
  preferredZoneId?: string | null,
) {
  const bays = await loadAtpBaysByItem(
    db,
    organizationId,
    lines.map((line) => line.itemId),
    { owner: order.clientId, excludeOrderId: order.id, warehouseId: order.warehouseId },
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
  imageUrl: schema.items.imageUrl,
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
  const soft = await loadOpenSoftAllocations(db, organizationId, { orderId: id });
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
    ? await withSuggestions(db, organizationId, lines, order, preferredZoneId)
    : lines.map(withRemaining);
  const packagesByOrder = await loadPackagesForOrders(db, [order.id]);
  const packages = packagesByOrder.get(order.id) ?? [];
  let parent: { id: string; number: string } | null = null;
  if (order.parentOrderId) {
    const [row] = await db
      .select({ id: schema.orders.id, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, order.parentOrderId), eq(schema.orders.organizationId, organizationId)))
      .limit(1);
    parent = row ?? null;
  }
  const backorders = await db
    .select({ id: schema.orders.id, number: schema.orders.number, status: schema.orders.status })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.parentOrderId, order.id)));
  const lineViews = withCartonRemaining(withAllocations(decorated, allocations, soft), packages);
  const reservedUnits = lineViews.reduce((sum, line) => sum + (line.reservedQty ?? 0), 0);
  const shortUnits = lineViews.reduce((sum, line) => sum + (line.shortQty ?? 0), 0);
  return {
    ...order,
    parent,
    backorders,
    allocatedUnits: allocatedUnits(allocations),
    reservedUnits,
    shortUnits,
    allocations,
    packages,
    lines: lineViews,
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

async function scanCheckLines(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  lines: { id: string; itemId: string; sku: string; barcode: string | null }[],
  posted: { lineId: string; qty: number }[],
): Promise<ScanCheckLine[]> {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const packs = await loadItemPacks(db, organizationId, lines.map((line) => line.itemId));
  return posted.map((row) => {
    const line = byId.get(row.lineId)!;
    return { lineId: row.lineId, qty: row.qty, sku: line.sku, barcode: line.barcode, packs: packs.get(line.itemId) };
  });
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
  const soft = await loadOpenSoftAllocations(db, organizationId);
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
      const softRows = soft.filter((held) => held.orderId === row.id);
      const packages = packagesByOrder.get(row.id) ?? [];
      const lines = withCartonRemaining(
        withAllocations((byOrder.get(row.id) ?? []).map(withRemaining), reserved, softRows),
        packages,
      );
      return {
        ...row,
        allocatedUnits: allocatedUnits(reserved),
        reservedUnits: lines.reduce((sum, line) => sum + (line.reservedQty ?? 0), 0),
        shortUnits: row.stockReservedAt == null ? 0 : lines.reduce((sum, line) => sum + (line.shortQty ?? 0), 0),
        allocations: reserved,
        packages,
        lines,
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
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    shipToAddress?: string;
    clientId?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const typedName = body.customerId ? body.customerName?.trim() : requireString(body.customerName, "customerName");
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
  const reserveLines: { id: string; itemId: string; sku: string; qty: number }[] = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    const item = await getOrgItem(db, organizationId, itemId);
    const lineId = newId();
    lines.push({ id: lineId, orderId: id, itemId, qty, qtyPicked: 0 });
    reserveLines.push({ id: lineId, itemId, sku: item.sku, qty });
  }
  const customer = await ensureCustomer(db, organizationId, {
    customerId: body.customerId,
    name: typedName ?? "",
    email: body.customerEmail,
    address: body.shipToAddress,
  });

  await db.batch([
    db.insert(schema.orders).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ORD"),
      customerName: typedName || customer.name,
      customerId: customer.id,
      status: "open",
      createdAt: Date.now(),
      clientId: body.clientId || null,
      ...destPatchFromAddress(body.shipToAddress),
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  await reserveOrderStock(db, {
    organizationId,
    warehouseId,
    orderId: id,
    clientId: body.clientId || null,
    lines: reserveLines,
  });
  const created = await orderWithLines(db, organizationId, id);
  await syncDocumentJob(db, orderJobInput(created));
  await scheduleShopifySellableSync(
    db,
    organizationId,
    lines.map((line) => line.itemId),
  );
  scheduleOrderCreated(db, organizationId, {
    number: created.number,
    status: created.status,
    city: created.shipToCity,
    lines: created.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
  });
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
    clientId: order.clientId,
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: remainingToPick(asPickLine(line)),
    })),
  });
  await db.update(schema.orders).set({ status: "picking" }).where(eq(schema.orders.id, order.id));
  await enqueueOrderPrepared(db, {
    organizationId,
    orderId: order.id,
    orderNumber: order.number,
    customerName: order.customerName,
    customerId: order.customerId,
    now: Date.now(),
    origin: c.get("origin"),
  });
  const started = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(started));
  return c.json(started);
});

async function postOrderPick(
  c: Context<AppEnv>,
  id: string,
  body: {
    locationId?: string;
    lines?: IncomingPick[];
    scan?: ScanEvidence;
    /** Server-recorded scan session. Manufacturer mode requires it; Garage ignores it. */
    sessionId?: string;
    /** The license plate scanned instead of the bay. The whole pick comes off it. */
    plateCode?: string;
  },
): Promise<Response> {
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, id, { suggest: false });
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
  const pickBay = await getOrgLocation(db, organizationId, locationId);
  const plateCode = normalizePlateCode(body.plateCode) ?? normalizePlateCode(body.scan?.locationScan);
  const plate = plateCode ? await plateForPick(db, organizationId, plateCode, pickBay) : null;
  const scanPolicy = await loadWorkflowPolicy(db, organizationId);
  let scanSessionId: string | null = null;
  if (requiresScan(scanPolicy, "pick")) {
    const scanned = resolveIncoming(order.lines, body.lines).filter((line) => line.qty > 0);
    const recorded = await loadRecordedScans(db, organizationId, user.id, body.sessionId);
    assertRecordedScans(
      scanPolicy,
      "pick",
      await scanCheckLines(db, organizationId, order.lines, scanned),
      recorded,
      pickBay,
    );
    scanSessionId = body.sessionId ?? null;
  }
  const allocations = await ensureAllocated(db, {
    organizationId,
    warehouseId: order.warehouseId,
    orderId: order.id,
    clientId: order.clientId,
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

  const pieces = plate
    ? drawFromPlate(
        plate,
        pickLines.map((line) => ({ itemId: line.itemId, sku: line.sku, qty: line.qty, lotCode: line.lotCode, serials: line.serials })),
      )
    : null;
  const picks = pieces
    ? pickLines.flatMap((line, index) => {
        const mine = pieces.filter((piece) => piece.want === index);
        const grams = splitCatchWeight(line.weightGrams, mine.map((piece) => piece.qty));
        return mine.map((piece, at) => ({
          ...line,
          qty: piece.qty,
          lotCode: piece.lotCode ?? line.lotCode,
          serials: piece.serials ?? line.serials,
          weightGrams: grams[at] ?? null,
        }));
      })
    : pickLines;
  const plateOps: PlateOp[] = plate
    ? picks.map((line) => ({
        kind: "take",
        plateId: plate.id,
        itemId: line.itemId,
        qty: line.qty,
        lotCode: line.lotCode,
        serials: line.serials,
      }))
    : [];

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    pickLines.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    picks.map(
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
    plateOps,
  });

  const picked = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(picked));
  await consumeItemScans(db, scanSessionId);
  await enqueueOrderPrepared(db, {
    organizationId,
    orderId: order.id,
    orderNumber: order.number,
    customerName: order.customerName,
    customerId: order.customerId,
    now,
    origin: c.get("origin"),
  });
  return c.json(picked);
}

ordersRoute.post("/orders/:id/pick", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: IncomingPick[];
    scan?: ScanEvidence;
    /** Server-recorded scan session. Manufacturer mode requires it; Garage ignores it. */
    sessionId?: string;
    /** The license plate scanned instead of the bay. The whole pick comes off it. */
    plateCode?: string;
    idempotencyKey?: unknown;
  }>();
  return runIdempotent(c, body.idempotencyKey, () => postOrderPick(c, c.req.param("id"), body));
});

ordersRoute.post("/orders/:id/pack", async (c) => {
  const body = await c.req
    .json<{ lines?: { lineId?: string; itemId?: string; qty?: number; serials?: string | string[] }[]; scan?: ScanEvidence; sessionId?: string }>()
    .catch(
      () =>
        ({}) as {
          lines?: { lineId?: string; itemId?: string; qty?: number; serials?: string | string[] }[];
          scan?: ScanEvidence;
          sessionId?: string;
        },
    );
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
  const packPolicy = await loadWorkflowPolicy(db, organizationId);
  let scanSessionId: string | null = null;
  let recorded: RecordedScan[] = [];
  if (requiresScan(packPolicy, "pack")) {
    recorded = await loadRecordedScans(db, organizationId, c.get("user")!.id, body.sessionId);
    assertRecordedScans(
      packPolicy,
      "pack",
      await scanCheckLines(db, organizationId, order.lines, incoming),
      recorded,
    );
    scanSessionId = body.sessionId ?? null;
  } else {
    assertScanned(packPolicy, "pack", await scanCheckLines(db, organizationId, order.lines, incoming), body.scan);
  }
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

  const serializedCount = incoming.filter((line) => order.lines.find((row) => row.id === line.lineId)?.trackSerial).length;
  await assignPackedSerials(db, {
    organizationId,
    userId: user.id,
    orderId: order.id,
    now,
    lines: incoming.map((line) => {
      const orderLine = order.lines.find((row) => row.id === line.lineId)!;
      const typed = body.lines?.find((row) => row.lineId === line.lineId || row.itemId === orderLine.itemId)?.serials;
      const serials = typed ? parseSerialList(typed) : serialsFromScans(orderLine.sku, recorded, serializedCount === 1);
      return {
        lineId: line.lineId,
        itemId: orderLine.itemId,
        sku: orderLine.sku,
        qty: line.qty,
        trackSerial: Boolean(orderLine.trackSerial),
        serials,
      };
    }),
  });

  const packed = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(packed));
  await consumeItemScans(db, scanSessionId);
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
      lines?: { lineId?: string; itemId?: string; qty?: number; serials?: string | string[] }[];
      pack?: boolean;
      scan?: ScanEvidence;
      sessionId?: string;
      weightOz?: number;
      lengthIn?: number;
      widthIn?: number;
      heightIn?: number;
    }>()
    .catch(
      () =>
        ({}) as {
          lines?: { lineId?: string; itemId?: string; qty?: number; serials?: string | string[] }[];
          pack?: boolean;
          scan?: ScanEvidence;
          sessionId?: string;
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
    let cartonSessionId: string | null = null;
    if (hasUnpacked(order.lines.map(asPackLine))) {
      const incomingPack = resolveIncomingPack(order.lines, body.lines).filter((line) => line.qty > 0);
      const cartonPolicy = await loadWorkflowPolicy(db, organizationId);
      if (requiresScan(cartonPolicy, "pack")) {
        assertRecordedScans(
          cartonPolicy,
          "pack",
          await scanCheckLines(db, organizationId, order.lines, incomingPack),
          await loadRecordedScans(db, organizationId, user.id, body.sessionId),
        );
        cartonSessionId = body.sessionId ?? null;
      } else {
        assertScanned(cartonPolicy, "pack", await scanCheckLines(db, organizationId, order.lines, incomingPack), body.scan);
      }
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
      const cartonScans = cartonSessionId
        ? await loadRecordedScans(db, organizationId, user.id, cartonSessionId)
        : [];
      const serializedCount = incomingPack.filter((line) => order.lines.find((row) => row.id === line.lineId)?.trackSerial).length;
      await assignPackedSerials(db, {
        organizationId,
        userId: user.id,
        orderId: order.id,
        now: nowPack,
        lines: incomingPack.map((line) => {
          const orderLine = order.lines.find((row) => row.id === line.lineId)!;
          const typed = body.lines?.find((row) => row.lineId === line.lineId || row.itemId === orderLine.itemId)?.serials;
          const serials = typed ? parseSerialList(typed) : serialsFromScans(orderLine.sku, cartonScans, serializedCount === 1);
          return {
            lineId: line.lineId,
            itemId: orderLine.itemId,
            sku: orderLine.sku,
            qty: line.qty,
            trackSerial: Boolean(orderLine.trackSerial),
            serials,
          };
        }),
      });
      await consumeItemScans(db, cartonSessionId);
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
  const seq = nextCartonSeq(order.packages);
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
  await linkAssignmentsToPackage(db, organizationId, order.id, applied.posted, packageId);
  const next = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(next));
  return c.json(next, 201);
});

ordersRoute.post("/orders/:id/packages/:pkgId/uncarton", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  const decision = canUncartonOrderPackage({ status: order.status, shippedAt: pkg.shippedAt });
  if (!decision.ok) conflict(decision.error, decision.code);
  if (pkg.labelStatus === "purchased") {
    await tryVoidOldAggregatorLabel(db, organizationId, {
      orderId: order.id,
      connectionId: pkg.carrierConnectionId,
      carrierShipmentId: pkg.carrierShipmentId,
      carrierLabelId: pkg.carrierLabelId,
      trackingNumber: pkg.trackingNumber,
      carrierService: pkg.carrierService,
      packageId: pkg.id,
    });
  }
  await db.delete(schema.orderPackages).where(eq(schema.orderPackages.id, pkg.id));
  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
  const patch = orderPatchFromPackages(packages) ?? emptyOrderPackagePatch();
  await db.update(schema.orders).set(patch).where(eq(schema.orders.id, order.id));
  const next = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(next));
  return c.json(next);
});

ordersRoute.post("/orders/:id/packages/:pkgId/ship", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canShipCartonOrder(order.status)) conflict("Order must be packing or packed before shipping a carton");
  const pkg = order.packages.find((row) => row.id === c.req.param("pkgId"));
  if (!pkg) notFound("Carton not found");
  const gate = canShipLabeledCarton(pkg);
  if (!gate.ok) conflict(gate.error, gate.code);
  if (canShipOrder(order.status)) {
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
  }
  const shippedCarton = await shipOrderCartons(db, c.env, organizationId, user.id, order, [pkg]);
  scheduleShippedEmail(c, shippedCarton);
  return c.json(shippedCarton);
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
  const { label, purchase, parcel, liveLabel, connection, customs, customsFormUrl } = await purchaseOrderLabel(
    db,
    organizationId,
    order,
    body,
    pkg,
  );
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
      ...(customsFormUrl !== undefined ? { customsFormUrl } : {}),
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
      ...(customs ? { customs } : {}),
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      message: postagePurchaseMessage({ provider: live ? connection?.provider : null }),
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
  const decision = canVoidLabel({ status: order.status, labelStatus: pkg.labelStatus, shippedAt: pkg.shippedAt });
  if (!decision.ok) {
    if (decision.code === "SHIPPED" || decision.code === "CANCELLED") conflict(decision.error);
    badRequest(decision.error);
  }
  const connections = await loadCarrierConnections(db, organizationId);
  const connection = connections.find((row) => row.id === pkg.carrierConnectionId) ?? null;
  if (connection && isLivePostage(connection.provider, connection.mode) && (pkg.carrierShipmentId || pkg.carrierLabelId)) {
    if (!connection.apiKey) conflict("Live void needs an API key", "CARRIER_LIVE");
    try {
      await voidLivePostage({
        connection,
        shipmentId: pkg.carrierShipmentId,
        labelId: pkg.carrierLabelId,
        trackingNumber: pkg.trackingNumber,
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
      customsFormUrl: null,
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
    response: { voided: true, live: Boolean(connection && isLivePostage(connection.provider, connection.mode)) },
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
  const { label, purchase, parcel, liveLabel, connection, customs, customsFormUrl } = await purchaseOrderLabel(
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
      customsFormUrl: customsFormUrl ?? null,
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
      ...(customs ? { customs } : {}),
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      previousTrackingNumber: pkg.trackingNumber,
      message: postagePurchaseMessage({ provider: liveLabel?.provider, replacement: true }),
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
  /** The quote a rate choice picked; recorded as postage when the carrier does not report a price. */
  quotedCents?: number;
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
    lines?: Array<{ itemId: string; qty: number }>;
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
  const abroad = internationalLabelBlock(order.shipToCountry, warehouse?.country);
  if (abroad) conflict(abroad.error, abroad.code);
  const shipFromAddress = warehouse?.shipFromAddress ?? null;
  const shipToAddress = body.shipToAddress?.trim() || order.shipToAddress;
  const parcel = parcelFrom(body, pkg ?? order);
  const connection = connections.find((row) => row.id === purchase.connectionId) ?? null;
  const explicitTracking = body.trackingNumber?.trim();
  const live =
    !explicitTracking &&
    connection &&
    isLivePostage(connection.provider, connection.mode);
  const existingTracking = options?.forceNewTracking ? null : pkg ? pkg.trackingNumber : order.trackingNumber;
  const minting = !explicitTracking && (live || !existingTracking);
  // A replacement for a parcel the carrier flagged goes where the first label went; that address can no longer change or be accepted.
  if (minting && !options?.forceNewTracking) {
    const address = await orderAddressVerdict(db, organizationId, {
      order,
      shipToAddress,
      buildingCountry: warehouse?.country,
      connections,
      verify: true,
    });
    if (address.blocked) throw new AddressInvalidError(address);
  }
  const customs = minting
    ? await customsForOrderLabel(db, organizationId, {
        order,
        lines: pkg?.lines ?? order.lines,
        warehouse,
        shipToAddress,
        parcelWeightOz: parcel.weightOz,
      })
    : null;
  let liveLabel = null;
  if (live) {
    if (!connection.apiKey) badRequest("Live postage needs an API key");
    const services = enabledServicesFromConnections([connection]).filter((row) => row.connectionId === connection.id);
    try {
      liveLabel = await buyLivePostage({
        connection,
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
        customs,
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: purchase.connectionId,
        orderId: order.id,
        kind: "buy",
        status: "failed",
        request: {
          carrierService: purchase.service.id,
          connectionId: purchase.connectionId,
          mode: "live",
          parcel,
          ...(customs ? { customs } : {}),
        },
        response: { error: err instanceof Error ? err.message : "Buy failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
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
  return {
    label,
    purchase,
    shipFromAddress,
    parcel,
    liveLabel,
    connection,
    customs,
    /** Undefined when this reused the label already on file, so the caller keeps its form. */
    customsFormUrl: minting ? (liveLabel?.customsFormUrl ?? null) : undefined,
  };
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
    !isLivePostage(connection.provider, connection.mode) ||
    !(input.carrierShipmentId || input.carrierLabelId)
  ) {
    return { voided: false };
  }
  if (!connection.apiKey) return { voided: false, error: "Live void needs an API key" };
  try {
    await voidLivePostage({
      connection,
      shipmentId: input.carrierShipmentId,
      labelId: input.carrierLabelId,
      trackingNumber: input.trackingNumber,
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
    (row) => isLivePostage(row.provider, row.mode) && Boolean(row.apiKey),
  );
  const liveIds = new Set(liveConnections.map((row) => row.id));
  const cannedServices = services.filter((row) => !row.connectionId || !liveIds.has(row.connectionId));
  const rates = quoteRates({
    services: cannedServices,
    shipFrom: shipFromAddress,
    shipTo: shipToAddress,
  });
  const customs = liveConnections.length
    ? await customsForOrderLabel(
        db,
        organizationId,
        { order, lines: order.lines, warehouse, shipToAddress, parcelWeightOz: parcel.weightOz },
        { quote: true },
      )
    : null;
  for (const connection of liveConnections) {
    const liveServices = services.filter((row) => row.connectionId === connection.id);
    if (liveServices.length === 0) continue;
    try {
      const shopped = await shopLiveRates({
        connection,
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
        customs,
      });
      rates.push(...shopped.rates);
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: connection.id,
        orderId: order.id,
        kind: "rates",
        status: "ok",
        request: { orderId: order.id, shipFromAddress, shipToAddress, parcel, mode: "live", ...(customs ? { customs } : {}) },
        response: { rates: shopped.rates, shipmentId: shopped.shipmentId ?? null },
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: connection.id,
        orderId: order.id,
        kind: "rates",
        status: "failed",
        request: { orderId: order.id, shipFromAddress, shipToAddress, parcel, mode: "live", ...(customs ? { customs } : {}) },
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
  const quotedCents = optionalInt(body.quotedCents, "quotedCents");
  if (quotedCents !== undefined && quotedCents < 0) badRequest("quotedCents cannot be negative");
  const { label, purchase, parcel, liveLabel, connection, customs, customsFormUrl } = await purchaseOrderLabel(
    db,
    organizationId,
    order,
    body,
  );
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
      postageCents: liveLabel?.postageCents ?? quotedCents ?? order.postageCents,
      trackerStatus: live ? "pre_transit" : order.trackerStatus,
      trackerUpdatedAt: live ? Date.now() : order.trackerUpdatedAt,
      ...parcelPatch(parcel),
      ...destPatchFromAddress(label.shipToAddress),
      ...(customsFormUrl !== undefined ? { customsFormUrl } : {}),
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
      ...(customs ? { customs } : {}),
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? quotedCents ?? null,
      message: postagePurchaseMessage({ provider: live ? connection?.provider : null }),
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
  if (connection && isLivePostage(connection.provider, connection.mode) && (order.carrierShipmentId || order.carrierLabelId)) {
    if (!connection.apiKey) conflict("Live void needs an API key", "CARRIER_LIVE");
    try {
      await voidLivePostage({
        connection,
        shipmentId: order.carrierShipmentId,
        labelId: order.carrierLabelId,
        trackingNumber: order.trackingNumber,
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
      customsFormUrl: null,
    })
    .where(eq(schema.orders.id, order.id));
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: order.carrierConnectionId,
    orderId: order.id,
    kind: "void",
    status: "ok",
    request: { trackingNumber: order.trackingNumber, carrierService: order.carrierService },
    response: { voided: true, live: Boolean(connection && isLivePostage(connection.provider, connection.mode)) },
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
  const { label, purchase, parcel, liveLabel, connection, customs, customsFormUrl } = await purchaseOrderLabel(
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
      customsFormUrl: customsFormUrl ?? null,
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
      ...(customs ? { customs } : {}),
    },
    response: {
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? null,
      previousTrackingNumber: order.trackingNumber,
      message: postagePurchaseMessage({ provider: liveLabel?.provider, replacement: true }),
    },
  });
  const next = await orderWithLines(db, organizationId, order.id, { suggest: false });
  const warehouse = await loadWarehouse(db, organizationId, next.warehouseId);
  return c.json(buildShippingLabel({ ...next, shipFromAddress: warehouse?.shipFromAddress ?? null }));
});

async function loadPickWeightsByItem(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  orderId: string,
): Promise<Map<string, number>> {
  const pickWeights = await db
    .select({
      itemId: schema.inventoryMovements.itemId,
      weightGrams: schema.inventoryMovements.weightGrams,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.refId, orderId),
        eq(schema.inventoryMovements.type, "pick"),
      ),
    );
  const weightByItem = new Map<string, number>();
  for (const row of pickWeights) {
    if (row.weightGrams == null) continue;
    weightByItem.set(row.itemId, (weightByItem.get(row.itemId) ?? 0) + row.weightGrams);
  }
  return weightByItem;
}

/** After the order is shipped. `waitUntil` keeps the mail off this request. */
function scheduleShippedEmail(
  c: Context<AppEnv>,
  order: {
    id: string;
    status: string;
    number: string;
    shipToCity?: string | null;
    trackingCompany?: string | null;
    carrierService?: string | null;
    trackingNumber?: string | null;
  },
) {
  if (order.status !== "shipped") return;
  scheduleCustomerEmails(c, { event: "shipped", orderIds: [order.id] });
  const organizationId = c.get("organizationId");
  if (!organizationId) return;
  scheduleOrderShipped(c.get("db"), organizationId, {
    number: order.number,
    status: order.status,
    carrier: order.trackingCompany || order.carrierService || null,
    trackingNumber: order.trackingNumber ?? null,
  });
}

async function shipOrderCartons(
  db: AppEnv["Variables"]["db"],
  env: AppEnv["Bindings"],
  organizationId: string,
  userId: string,
  order: Awaited<ReturnType<typeof orderWithLines>>,
  pkgs: OrderPackageRow[],
) {
  const toShip = pkgs.filter((row) => !row.shippedAt);
  if (toShip.length === 0) conflict("Carton is already shipped", "SHIPPED");
  for (const pkg of toShip) {
    const gate = canShipLabeledCarton(pkg);
    if (!gate.ok) conflict(gate.error, gate.code);
  }

  const now = Date.now();
  const weightByItem = await loadPickWeightsByItem(db, organizationId, order.id);
  const qtysByItem = new Map<string, number[]>();
  for (const pkg of toShip) {
    for (const line of pkg.lines) {
      if (line.qty <= 0) continue;
      const list = qtysByItem.get(line.itemId) ?? [];
      list.push(line.qty);
      qtysByItem.set(line.itemId, list);
    }
  }
  const shareCursor = new Map<string, { shares: Array<number | null>; index: number }>();
  for (const [itemId, qtys] of qtysByItem) {
    const orderLine = order.lines.find((line) => line.itemId === itemId);
    if (!orderLine?.catchWeight) continue;
    shareCursor.set(itemId, { shares: splitCatchWeight(weightByItem.get(itemId) ?? null, qtys), index: 0 });
  }

  const movements: MovementDraft[] = [];
  for (const pkg of toShip) {
    for (const line of pkg.lines) {
      if (line.qty <= 0) continue;
      const orderLine = order.lines.find((row) => row.id === line.orderLineId);
      let weightGrams: number | null = null;
      if (orderLine?.catchWeight) {
        const cursor = shareCursor.get(line.itemId);
        const grams = cursor ? (cursor.shares[cursor.index] ?? null) : null;
        if (cursor) cursor.index += 1;
        weightGrams = lineCatchWeight(true, line.sku, grams);
      }
      movements.push({
        type: "ship",
        itemId: line.itemId,
        qty: line.qty,
        fromLocationId: order.pickLocationId,
        refType: "order",
        refId: order.id,
        weightGrams,
      });
    }
  }

  const nextPackages = order.packages.map((row) =>
    toShip.some((pkg) => pkg.id === row.id) ? { ...row, shippedAt: now } : row,
  );
  const packedUnits = order.lines.reduce((sum, line) => sum + line.qtyPacked, 0);
  const complete = isCartonShipComplete({
    packedUnits,
    unpacked: hasUnpacked(order.lines.map(asPackLine)),
    packages: nextPackages.map((row) => ({
      units: row.units,
      trackingNumber: row.trackingNumber,
      shippedAt: row.shippedAt,
    })),
  });
  const trackingPatch = orderPatchFromPackages(nextPackages) ?? {};
  const plan: StockPlan = { balances: new Map(), movements };
  await persistStockPlan(db, {
    organizationId,
    createdBy: userId,
    now,
    loaded: new Map(),
    plan,
    extra: [
      ...toShip.map((pkg) =>
        db.update(schema.orderPackages).set({ shippedAt: now }).where(eq(schema.orderPackages.id, pkg.id)),
      ),
      db
        .update(schema.orders)
        .set({
          ...(complete
            ? {
                status: "shipped" as const,
                shippedAt: now,
                shopifySyncStatus: order.source === "shopify" ? "pending_fulfill" : order.shopifySyncStatus,
              }
            : {}),
          ...trackingPatch,
          trackingToken: order.trackingToken ?? newPublicToken(),
        })
        .where(eq(schema.orders.id, order.id)),
      ...(complete ? releaseAllocationStatements(db, order.id, now) : []),
    ],
  });

  let shopify;
  if (order.source === "shopify") {
    for (const pkg of toShip) {
      shopify = await fulfillShopifyOrder(db, organizationId, order.id, { packageId: pkg.id });
      if (shopify.status === "failed") break;
    }
  }
  let shipped = await orderWithLines(db, organizationId, order.id);
  let channel;
  if (shipped.status === "shipped" && postsTrackingBack(order.source)) {
    channel = await fulfillChannelOrder(db, env, organizationId, order.id);
    shipped = await orderWithLines(db, organizationId, order.id);
  }
  await syncDocumentJob(db, orderJobInput(shipped));
  await stampShipmentWarranties(db, {
    organizationId,
    orderId: order.id,
    now,
    trackingNumber: toShip[0]?.trackingNumber ?? shipped.trackingNumber ?? null,
    packageIds: toShip.map((pkg) => pkg.id),
    orderComplete: shipped.status === "shipped",
  });
  return { ...shipped, shopify, channel };
}

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
  const packedUnits = order.lines.reduce((sum, line) => sum + line.qtyPacked, 0);
  const shipGate = cartonShipGate({
    packedUnits,
    packages: order.packages.map((row) => ({
      units: row.units,
      trackingNumber: row.trackingNumber,
      shippedAt: row.shippedAt,
    })),
  });
  if (!shipGate.ok) conflict(shipGate.error, shipGate.code);

  if (order.packages.length > 0) {
    const shippedCartons = await shipOrderCartons(db, c.env, organizationId, user.id, order, order.packages);
    scheduleShippedEmail(c, shippedCartons);
    return c.json(shippedCartons);
  }

  const locationId = order.pickLocationId;
  if (!locationId) conflict("Pick location missing");
  const weightByItem = await loadPickWeightsByItem(db, organizationId, order.id);
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
  const { label, purchase, parcel, liveLabel, customsFormUrl } = await purchaseOrderLabel(db, organizationId, order, body);
  const liveBuy = Boolean(liveLabel);
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
          trackingToken: order.trackingToken ?? newPublicToken(),
          carrierService: label.carrierServiceId,
          carrierConnectionId: purchase.connectionId,
          labelStatus: "purchased",
          carrierShipmentId: liveLabel?.shipmentId ?? order.carrierShipmentId,
          carrierLabelId: liveLabel?.labelId ?? order.carrierLabelId,
          postageCents: liveLabel?.postageCents ?? order.postageCents,
          trackerStatus: liveBuy ? "pre_transit" : order.trackerStatus,
          trackerUpdatedAt: liveBuy ? now : order.trackerUpdatedAt,
          ...(customsFormUrl !== undefined ? { customsFormUrl } : {}),
          ...parcelPatch(parcel),
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
  const channel = postsTrackingBack(order.source)
    ? await fulfillChannelOrder(db, c.env, organizationId, order.id)
    : undefined;
  const shipped = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(shipped));
  await stampShipmentWarranties(db, {
    organizationId,
    orderId: order.id,
    now,
    trackingNumber: shipped.trackingNumber,
    packageIds: [],
    orderComplete: true,
    origin: c.get("origin"),
  });
  scheduleShippedEmail(c, shipped);
  return c.json({ ...shipped, shopify, channel });
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
    badRequestFrom(err, "Invalid unpick");
  }
  const unpicked = await orderWithLines(db, organizationId, order.id);
  await syncDocumentJob(db, orderJobInput(unpicked));
  return c.json(unpicked);
});

ordersRoute.post("/orders/:id/short-ship", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  const plan = planShortShip({
    status: order.status,
    lines: order.lines.map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      qty: line.qty,
      qtyPicked: line.qtyPicked,
      qtyPacked: line.qtyPacked ?? 0,
    })),
    packages: order.packages.map((pkg) => ({
      id: pkg.id,
      shippedAt: pkg.shippedAt,
      lines: pkg.lines.map((line) => ({ orderLineId: line.orderLineId, qty: line.qty })),
    })),
  });
  if (!plan.ok) conflict(plan.error, plan.code);

  for (const packageId of plan.dropPackageIds) {
    const pkg = order.packages.find((row) => row.id === packageId);
    if (!pkg || pkg.labelStatus !== "purchased") continue;
    await tryVoidOldAggregatorLabel(db, organizationId, {
      orderId: order.id,
      connectionId: pkg.carrierConnectionId,
      carrierShipmentId: pkg.carrierShipmentId,
      carrierLabelId: pkg.carrierLabelId,
      trackingNumber: pkg.trackingNumber,
      carrierService: pkg.carrierService,
      packageId: pkg.id,
    });
  }

  const now = Date.now();
  const kept = order.packages.filter((pkg) => !plan.dropPackageIds.includes(pkg.id));
  const trackingPatch = orderPatchFromPackages(kept) ?? emptyOrderPackagePatch();
  const taken = await db
    .select({ number: schema.orders.number })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), like(schema.orders.number, `${order.number}-BO%`)));
  const backorderId = newId();
  const number = backorderNumber(
    order.number,
    taken.map((row) => row.number),
  );
  const channel = shopifyBackorderFields(order);
  const dropStatements =
    plan.dropPackageIds.length > 0
      ? [
          db.delete(schema.orderPackageLines).where(inArray(schema.orderPackageLines.packageId, plan.dropPackageIds)),
          db.delete(schema.orderPackages).where(inArray(schema.orderPackages.id, plan.dropPackageIds)),
        ]
      : [];
  const closeOrder = db
    .update(schema.orders)
    .set({
      status: "shipped",
      shippedAt: order.shippedAt ?? now,
      ...trackingPatch,
    })
    .where(eq(schema.orders.id, order.id));
  const childOrder = db.insert(schema.orders).values({
    id: backorderId,
    organizationId,
    warehouseId: order.warehouseId,
    number,
    customerName: order.customerName,
    customerId: order.customerId,
    status: "open",
    createdAt: now,
    source: channel.source,
    shopifyOrderGid: channel.shopifyOrderGid,
    shopifyOrderName: channel.shopifyOrderName,
    shopifyFulfillmentOrderId: channel.shopifyFulfillmentOrderId,
    shopifyShopDomain: channel.shopifyShopDomain,
    shopifySyncStatus: channel.shopifySyncStatus,
    shipToAddress: order.shipToAddress,
    shipToCity: order.shipToCity,
    shipToRegion: order.shipToRegion,
    shipToCountry: order.shipToCountry,
    shipToLat: order.shipToLat,
    shipToLng: order.shipToLng,
    clientId: order.clientId,
    carrierService: order.carrierService,
    parentOrderId: order.id,
  });
  const childLineRows = plan.remainder.map((row) => {
    const parentLine = order.lines.find((line) => line.id === row.lineId);
    return {
      id: newId(),
      orderId: backorderId,
      itemId: row.itemId,
      sku: parentLine?.sku ?? row.itemId,
      qty: row.qty,
      qtyPicked: 0,
      qtyPacked: 0,
      shopifyLineItemId: parentLine?.shopifyLineItemId ?? null,
      shopifyFulfillmentLineItemId: parentLine?.shopifyFulfillmentLineItemId ?? null,
    };
  });
  const childLines = childLineRows.map((row) =>
    db.insert(schema.orderLines).values({
      id: row.id,
      orderId: row.orderId,
      itemId: row.itemId,
      qty: row.qty,
      qtyPicked: row.qtyPicked,
      qtyPacked: row.qtyPacked,
      shopifyLineItemId: row.shopifyLineItemId,
      shopifyFulfillmentLineItemId: row.shopifyFulfillmentLineItemId,
    }),
  );
  const shippedQtyByLine = new Map(plan.shippedByLine.map((row) => [row.lineId, row.qty]));
  const stampLines = order.lines.map((line) => {
    const shippedQty = shippedQtyByLine.get(line.id) ?? 0;
    return db
      .update(schema.orderLines)
      .set({
        qtyPicked: shippedQty,
        qtyPacked: Math.min(line.qtyPacked ?? 0, shippedQty),
      })
      .where(eq(schema.orderLines.id, line.id));
  });
  const extra = [
    ...dropStatements,
    closeOrder,
    ...stampLines,
    ...releaseAllocationStatements(db, order.id, now),
    ...releaseSoftAllocationStatements(db, order.id, now),
    childOrder,
    ...childLines,
  ];

  const slices = await loadNetPickSlices(db, organizationId, order.id);
  const sliceQtyByItem = new Map<string, number>();
  for (const slice of slices) sliceQtyByItem.set(slice.itemId, (sliceQtyByItem.get(slice.itemId) ?? 0) + slice.qty);
  const covered = ledgerUnpick(
    plan.unpick.map((row) => ({
      lineId: row.lineId,
      itemId: order.lines.find((line) => line.id === row.lineId)?.itemId ?? "",
      qty: row.qty,
    })),
    sliceQtyByItem,
  );

  if (covered.length > 0) {
    try {
      await persistUnpick({
        db,
        organizationId,
        createdBy: user.id,
        warehouseId: order.warehouseId,
        orderId: order.id,
        pickLocationId: order.pickLocationId,
        lines: order.lines.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          sku: line.sku,
          qty: line.qty,
          qtyPicked: line.qtyPicked,
          qtyPacked: line.qtyPacked ?? 0,
        })),
        incoming: covered,
        includePacked: true,
        restoreAllocations: false,
        skipStatusUpdate: true,
        extra,
      });
    } catch (err) {
      if (err instanceof OverUnpickError) throw err;
      badRequestFrom(err, "Could not return unshipped qty");
    }
  } else {
    await db.batch(extra as [typeof closeOrder, ...(typeof closeOrder)[]]);
  }

  if (order.source === "shopify") {
    await fulfillShopifyOrder(db, organizationId, order.id);
  }
  const shipped = await orderWithLines(db, organizationId, order.id);
  const backorder = await orderWithLines(db, organizationId, backorderId);
  await syncDocumentJob(db, orderJobInput(shipped));
  await syncDocumentJob(db, orderJobInput(backorder));
  await reserveOrderStock(db, {
    organizationId,
    warehouseId: order.warehouseId,
    orderId: backorderId,
    clientId: order.clientId,
    lines: childLineRows.map((row) => ({ id: row.id, itemId: row.itemId, sku: row.sku, qty: row.qty })),
  });
  await scheduleShopifySellableSync(
    db,
    organizationId,
    order.lines.map((line) => line.itemId),
  );
  scheduleShippedEmail(c, shipped);
  scheduleOrderCreated(db, organizationId, {
    number: backorder.number,
    status: backorder.status,
    city: backorder.shipToCity,
    lines: backorder.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
  });
  return c.json(shipped);
});

ordersRoute.post("/orders/:id/cancel", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canCancelOrder(order.status)) conflict("Order cannot be cancelled");
  if (order.packages.some((pkg) => pkg.shippedAt)) {
    conflict("Shipped cartons stay out. Short-ship the remainder.", "SHIPPED");
  }
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
