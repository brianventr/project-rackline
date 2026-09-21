import { and, desc, eq, gte, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { applyHoldsToOnHand } from "../domain/holds";
import { loadHeldLotQuantities, loadOpenHolds } from "./holds";
import { isOpenPickStatus, remainingToPickQty } from "../domain/shopify-sellable";
import { majorityVendor } from "../domain/reorder";
import {
  DEFAULT_LEAD_MS,
  DAY_MS,
  ORDER_SOON_DAYS,
  buildRunwayBoard,
  buildRunwayDraftLines,
  clampLeadTimeMs,
  countShipDays,
  formatUtcDay,
  medianPositive,
  windowLookbackMs,
  type BomComponent,
  type InboundReceipt,
  type RunwayBoard,
  type RunwayDraftLine,
  type RunwayItemFact,
  type RunwayLot,
  type RunwayWindow,
} from "../domain/runway";

const OPEN_PO_STATUSES = ["draft", "ordered", "receiving"] as const;
const OPEN_ASN_STATUSES = ["draft", "expected", "receiving"] as const;
const OPEN_MAKE_STATUSES = ["draft", "in_progress"] as const;

export type RunwayQueue = {
  board: RunwayBoard;
  orgVendor: string | null;
  draftLines: RunwayDraftLine[];
};

export async function loadRunway(
  db: AppDb,
  organizationId: string,
  options: { warehouseId?: string; window?: RunwayWindow; multiplier?: number; asOf?: number } = {},
): Promise<RunwayQueue> {
  const asOf = options.asOf ?? Date.now();
  const window = options.window ?? "30d";
  const multiplier = options.multiplier ?? 1;
  const warehouseId = options.warehouseId;
  const lookback = asOf - windowLookbackMs(window);

  const catalog = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      trackExpiry: schema.items.trackExpiry,
      baselineShipRate: schema.items.baselineShipRate,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId))
    .orderBy(schema.items.sku);

  const balances = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      locationId: schema.inventoryBalances.locationId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );

  const holds = await loadOpenHolds(db, organizationId, warehouseId);
  const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
  const availableRows = applyHoldsToOnHand(balances, holds, lotQtys);

  const onHandByItem = new Map<string, number>();
  const availableByItem = new Map<string, number>();
  for (const row of balances) {
    onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }
  for (const row of availableRows) {
    availableByItem.set(row.itemId, (availableByItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }

  const openLines = await db
    .select({
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      status: schema.orders.status,
    })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    );
  const remainingByItem = new Map<string, number>();
  for (const line of openLines) {
    if (!isOpenPickStatus(line.status)) continue;
    remainingByItem.set(
      line.itemId,
      (remainingByItem.get(line.itemId) ?? 0) + remainingToPickQty(line.qty, line.qtyPicked),
    );
  }

  const lotRows = await db
    .select({
      itemId: schema.lotBalances.itemId,
      qty: schema.lotBalances.qty,
      expiresOn: schema.lotBalances.expiresOn,
    })
    .from(schema.lotBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
    .where(
      and(
        eq(schema.lotBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const lotsByItem = new Map<string, RunwayLot[]>();
  for (const row of lotRows) {
    const list = lotsByItem.get(row.itemId) ?? [];
    list.push({ qty: row.qty, expiresOn: row.expiresOn });
    lotsByItem.set(row.itemId, list);
  }

  const shippedOrders = await db
    .select({
      id: schema.orders.id,
      shippedAt: schema.orders.shippedAt,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.status, "shipped"),
        gte(schema.orders.shippedAt, lookback),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    );
  const shippedIds = shippedOrders.map((row) => row.id);
  const shippedAtByOrder = new Map(shippedOrders.map((row) => [row.id, row.shippedAt ?? 0]));
  const shippedLines =
    shippedIds.length === 0
      ? []
      : await db
          .select({
            orderId: schema.orderLines.orderId,
            itemId: schema.orderLines.itemId,
            qty: schema.orderLines.qty,
          })
          .from(schema.orderLines)
          .where(inArray(schema.orderLines.orderId, shippedIds));

  const unitsByItem = new Map<string, number>();
  const stampsByItem = new Map<string, number[]>();
  const dailyByItem = new Map<string, Map<string, number>>();
  for (const line of shippedLines) {
    const shippedAt = shippedAtByOrder.get(line.orderId) ?? 0;
    unitsByItem.set(line.itemId, (unitsByItem.get(line.itemId) ?? 0) + line.qty);
    const stamps = stampsByItem.get(line.itemId) ?? [];
    stamps.push(shippedAt);
    stampsByItem.set(line.itemId, stamps);
    const day = formatUtcDay(shippedAt);
    const days = dailyByItem.get(line.itemId) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + line.qty);
    dailyByItem.set(line.itemId, days);
  }

  const asnRows = await db
    .select({
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      expectedAt: schema.asns.expectedAt,
      eta: schema.asns.eta,
      createdAt: schema.asns.createdAt,
    })
    .from(schema.asnLines)
    .innerJoin(schema.asns, eq(schema.asns.id, schema.asnLines.asnId))
    .where(
      and(
        eq(schema.asns.organizationId, organizationId),
        inArray(schema.asns.status, [...OPEN_ASN_STATUSES]),
        warehouseId ? eq(schema.asns.warehouseId, warehouseId) : undefined,
      ),
    );
  const asnRemainingByItem = new Map<string, number>();
  const asnInboundByItem = new Map<string, InboundReceipt[]>();
  for (const row of asnRows) {
    const remaining = Math.max(0, row.qtyExpected - row.qtyReceived);
    if (remaining <= 0) continue;
    asnRemainingByItem.set(row.itemId, (asnRemainingByItem.get(row.itemId) ?? 0) + remaining);
    const at = row.expectedAt ?? row.eta ?? row.createdAt;
    const list = asnInboundByItem.get(row.itemId) ?? [];
    list.push({ at, qty: remaining });
    asnInboundByItem.set(row.itemId, list);
  }

  const poRows = await db
    .select({
      itemId: schema.purchaseLines.itemId,
      qtyOrdered: schema.purchaseLines.qtyOrdered,
      qtyReceived: schema.purchaseLines.qtyReceived,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(
      and(
        eq(schema.purchases.organizationId, organizationId),
        inArray(schema.purchases.status, [...OPEN_PO_STATUSES]),
        warehouseId ? eq(schema.purchases.warehouseId, warehouseId) : undefined,
      ),
    );
  const poRemainingByItem = new Map<string, number>();
  const coveredItemIds = new Set<string>();
  for (const row of poRows) {
    coveredItemIds.add(row.itemId);
    poRemainingByItem.set(row.itemId, (poRemainingByItem.get(row.itemId) ?? 0) + Math.max(0, row.qtyOrdered - row.qtyReceived));
  }

  const bomRows = await db
    .select({
      parentItemId: schema.boms.itemId,
      componentItemId: schema.bomLines.itemId,
      qty: schema.bomLines.qty,
    })
    .from(schema.bomLines)
    .innerJoin(schema.boms, eq(schema.boms.id, schema.bomLines.bomId))
    .where(eq(schema.boms.organizationId, organizationId));
  const boms: BomComponent[] = bomRows;

  const workOrders = await db
    .select({
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
    })
    .from(schema.workOrders)
    .where(
      and(
        eq(schema.workOrders.organizationId, organizationId),
        inArray(schema.workOrders.status, [...OPEN_MAKE_STATUSES]),
        warehouseId ? eq(schema.workOrders.warehouseId, warehouseId) : undefined,
      ),
    );
  const kits = await db
    .select({
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
    })
    .from(schema.kitBuilds)
    .where(
      and(
        eq(schema.kitBuilds.organizationId, organizationId),
        inArray(schema.kitBuilds.status, [...OPEN_MAKE_STATUSES]),
        warehouseId ? eq(schema.kitBuilds.warehouseId, warehouseId) : undefined,
      ),
    );
  const makeRemaining = new Map<string, number>();
  for (const row of [...workOrders, ...kits]) {
    const remaining = Math.max(0, row.qty - row.qtyCompleted);
    if (remaining <= 0) continue;
    makeRemaining.set(row.itemId, (makeRemaining.get(row.itemId) ?? 0) + remaining);
  }

  const vendorRows = await db
    .select({
      itemId: schema.purchaseLines.itemId,
      vendorName: schema.purchases.vendorName,
      createdAt: schema.purchases.createdAt,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(
      and(
        eq(schema.purchases.organizationId, organizationId),
        warehouseId ? eq(schema.purchases.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.purchases.createdAt));
  const lastVendorByItem = new Map<string, string>();
  for (const row of vendorRows) {
    const name = row.vendorName?.trim();
    if (!name || lastVendorByItem.has(row.itemId)) continue;
    lastVendorByItem.set(row.itemId, name);
  }
  const orgVendor =
    majorityVendor(
      vendorRows
        .map((row) => row.vendorName?.trim())
        .filter((name): name is string => Boolean(name))
        .map((vendorName) => ({
          itemId: "",
          sku: "",
          name: "",
          qty: 1,
          onHand: 0,
          reorderPoint: 0,
          vendorName,
        })),
      "",
    ) || null;

  const leadRows = await db
    .select({
      itemId: schema.asnLines.itemId,
      orderedAt: schema.purchases.orderedAt,
      expectedAt: schema.asns.expectedAt,
      eta: schema.asns.eta,
    })
    .from(schema.asnLines)
    .innerJoin(schema.asns, eq(schema.asns.id, schema.asnLines.asnId))
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.asns.purchaseId))
    .where(
      and(
        eq(schema.asns.organizationId, organizationId),
        warehouseId ? eq(schema.asns.warehouseId, warehouseId) : undefined,
      ),
    );
  const leadByItem = new Map<string, number[]>();
  const allLeads: number[] = [];
  for (const row of leadRows) {
    const start = row.orderedAt;
    const end = row.expectedAt ?? row.eta;
    if (start == null || end == null) continue;
    const ms = end - start;
    if (ms <= 0) continue;
    allLeads.push(ms);
    const list = leadByItem.get(row.itemId) ?? [];
    list.push(ms);
    leadByItem.set(row.itemId, list);
  }
  const orgLead = clampLeadTimeMs(medianPositive(allLeads, DEFAULT_LEAD_MS));

  const items: RunwayItemFact[] = catalog.map((item) => {
    const onHand = onHandByItem.get(item.id) ?? 0;
    const available = availableByItem.get(item.id) ?? 0;
    const held = Math.max(0, onHand - available);
    const leadTimeMs = clampLeadTimeMs(medianPositive(leadByItem.get(item.id) ?? [], orgLead));
    const inbound = [...(asnInboundByItem.get(item.id) ?? [])];
    const poNet = Math.max(0, (poRemainingByItem.get(item.id) ?? 0) - (asnRemainingByItem.get(item.id) ?? 0));
    if (poNet > 0) inbound.push({ at: asOf + leadTimeMs, qty: poNet });
    const stamps = stampsByItem.get(item.id) ?? [];
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      trackExpiry: Boolean(item.trackExpiry),
      baselineShipRate: item.baselineShipRate,
      onHand,
      held,
      remainingToPick: remainingByItem.get(item.id) ?? 0,
      lots: lotsByItem.get(item.id),
      unitsShipped: unitsByItem.get(item.id) ?? 0,
      shipDays: countShipDays(stamps, lookback, asOf),
      dailyShipped: [...(dailyByItem.get(item.id) ?? [])].map(([day, qty]) => ({ day, qty })),
      inbound,
      lastVendorName: lastVendorByItem.get(item.id) ?? orgVendor,
      leadTimeMs,
      coveredByOpenPo: coveredItemIds.has(item.id),
    };
  });

  const board = buildRunwayBoard({ asOf, window, multiplier, items, boms, makeRemaining });
  const draftLines = buildRunwayDraftLines(board.rows, orgVendor);
  return { board, orgVendor, draftLines };
}

export async function loadRunwayThisWeek(
  db: AppDb,
  organizationId: string,
  warehouseId?: string,
) {
  const queue = await loadRunway(db, organizationId, { warehouseId, window: "30d", multiplier: 1 });
  return queue.board.rows
    .filter((row) => row.status !== "idle" && row.stockoutAt != null && row.stockoutAt <= queue.board.asOf + ORDER_SOON_DAYS * DAY_MS)
    .map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      sellable: row.sellable,
      daysOfCover: row.daysOfCover,
      stockoutAt: row.stockoutAt,
      status: row.status,
      suggestedQty: row.suggestedQty,
      coveredByOpenPo: row.coveredByOpenPo,
      lastVendorName: row.lastVendorName,
    }));
}
