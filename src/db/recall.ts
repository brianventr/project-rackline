import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { expandRecallCodes, movementMatchesRecall, orderIsOpen } from "../domain/recall";
import { coveringHold, matchingSerialHold } from "../domain/holds";
import { badRequest, conflict } from "../lib/http";
import { docNumber, newId } from "../lib/ids";
import { loadOpenHolds } from "./holds";
import { syncDocumentJob } from "./jobs";
import { scheduleShopifySellableSync } from "./shopify-sellable";

export type RecallTracking = { number: string; company: string | null };

export type RecallOrder = {
  orderId: string;
  number: string;
  source: string;
  status: string;
  open: boolean;
  qty: number;
  tracking: RecallTracking[];
};

export async function loadRecall(
  db: AppDb,
  organizationId: string,
  raw: string,
): Promise<{ query: string; orders: RecallOrder[] }> {
  const query = raw.trim();
  if (!query) return { query: "", orders: [] };
  const links = await db
    .select({
      parentLotCode: schema.asBuilt.parentLotCode,
      parentSerial: schema.asBuilt.parentSerial,
      componentLotCode: schema.asBuilt.componentLotCode,
      componentSerial: schema.asBuilt.componentSerial,
    })
    .from(schema.asBuilt)
    .where(eq(schema.asBuilt.organizationId, organizationId));
  const { lots, serials } = expandRecallCodes(query, links);
  const lotList = [...lots];
  const serialLikes = [...serials].map((code) => sql`${schema.inventoryMovements.serialsJson} like ${`%"${code}"%`}`);
  const movements = await db
    .select({
      type: schema.inventoryMovements.type,
      refId: schema.inventoryMovements.refId,
      qty: schema.inventoryMovements.qty,
      lotCode: schema.inventoryMovements.lotCode,
      serialsJson: schema.inventoryMovements.serialsJson,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        inArray(schema.inventoryMovements.type, ["pick", "ship"]),
        eq(schema.inventoryMovements.refType, "order"),
        or(inArray(schema.inventoryMovements.lotCode, lotList), ...serialLikes),
      ),
    );
  const hits = movements.filter((row) => movementMatchesRecall(row, lots, serials));
  const qtyByOrder = new Map<string, { pick: number; ship: number }>();
  for (const row of hits) {
    const bucket = qtyByOrder.get(row.refId) ?? { pick: 0, ship: 0 };
    const qty = Math.abs(Number(row.qty) || 0);
    if (row.type === "pick") bucket.pick += qty;
    else bucket.ship += qty;
    qtyByOrder.set(row.refId, bucket);
  }
  const orderIds = [...qtyByOrder.keys()];
  if (orderIds.length === 0) return { query, orders: [] };
  const [orders, packages] = await Promise.all([
    db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        source: schema.orders.source,
        status: schema.orders.status,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.organizationId, organizationId), inArray(schema.orders.id, orderIds))),
    db
      .select({
        orderId: schema.orderPackages.orderId,
        trackingNumber: schema.orderPackages.trackingNumber,
        trackingCompany: schema.orderPackages.trackingCompany,
        shippedAt: schema.orderPackages.shippedAt,
      })
      .from(schema.orderPackages)
      .where(and(eq(schema.orderPackages.organizationId, organizationId), inArray(schema.orderPackages.orderId, orderIds))),
  ]);
  const tracking = new Map<string, RecallTracking[]>();
  for (const row of packages) {
    if (!row.shippedAt && !row.trackingNumber) continue;
    if (!row.trackingNumber) continue;
    const list = tracking.get(row.orderId) ?? [];
    list.push({ number: row.trackingNumber, company: row.trackingCompany });
    tracking.set(row.orderId, list);
  }
  return {
    query,
    orders: orders
      .map((order) => {
        const bucket = qtyByOrder.get(order.id) ?? { pick: 0, ship: 0 };
        return {
          orderId: order.id,
          number: order.number,
          source: order.source,
          status: order.status,
          open: orderIsOpen(order.status),
          qty: bucket.pick > 0 ? bucket.pick : bucket.ship,
          tracking: tracking.get(order.id) ?? [],
        };
      })
      .sort((a, b) => a.number.localeCompare(b.number)),
  };
}

export type RecallHold = {
  id: string;
  number: string;
  locationId: string;
  locationCode: string;
  itemId: string;
  sku: string;
  lotCode: string | null;
  serialCode: string | null;
};

function recallCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Hold on-hand remainder of a recalled lot or serial. Picked stock stays on the open order. */
export async function holdRecallRemainder(
  db: AppDb,
  organizationId: string,
  raw: string,
): Promise<{ query: string; created: RecallHold[] }> {
  const query = raw.trim();
  if (!query) badRequest("Lot or serial is required");
  const links = await db
    .select({
      parentLotCode: schema.asBuilt.parentLotCode,
      parentSerial: schema.asBuilt.parentSerial,
      componentLotCode: schema.asBuilt.componentLotCode,
      componentSerial: schema.asBuilt.componentSerial,
    })
    .from(schema.asBuilt)
    .where(eq(schema.asBuilt.organizationId, organizationId));
  const { lots, serials } = expandRecallCodes(query, links);

  const [balances, onHandSerials] = await Promise.all([
    db
      .select({
        locationId: schema.lotBalances.locationId,
        itemId: schema.lotBalances.itemId,
        lotCode: schema.lotBalances.lotCode,
        qty: schema.lotBalances.qty,
        warehouseId: schema.locations.warehouseId,
        locationCode: schema.locations.code,
        sku: schema.items.sku,
      })
      .from(schema.lotBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
      .innerJoin(schema.items, eq(schema.items.id, schema.lotBalances.itemId))
      .where(and(eq(schema.lotBalances.organizationId, organizationId), gt(schema.lotBalances.qty, 0))),
    db
      .select({
        itemId: schema.serials.itemId,
        serialCode: schema.serials.serialCode,
        locationId: schema.serials.locationId,
        warehouseId: schema.locations.warehouseId,
        locationCode: schema.locations.code,
        sku: schema.items.sku,
      })
      .from(schema.serials)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.serials.locationId))
      .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
      .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.status, "on_hand"))),
  ]);

  const matchedSerials = onHandSerials.filter(
    (row): row is typeof row & { locationId: string } =>
      Boolean(row.locationId) && serials.has(recallCode(row.serialCode)),
  );
  const serialCodes = new Set(matchedSerials.map((row) => recallCode(row.serialCode)));
  const matchedLots = balances.filter((row) => {
    const code = recallCode(row.lotCode);
    return lots.has(code) && !serialCodes.has(code);
  });
  if (matchedLots.length === 0 && matchedSerials.length === 0) {
    conflict("Nothing of that lot or serial is still on hand", "NOTHING_ON_HAND");
  }

  const open = await loadOpenHolds(db, organizationId);
  const created: RecallHold[] = [];
  const touched = new Set<string>();
  const now = Date.now();

  async function insertHold(input: {
    warehouseId: string;
    locationId: string;
    locationCode: string;
    itemId: string;
    sku: string;
    lotCode: string | null;
    serialCode: string | null;
  }) {
    const id = newId();
    const number = docNumber("HLD");
    await db.insert(schema.inventoryHolds).values({
      id,
      organizationId,
      warehouseId: input.warehouseId,
      number,
      status: "open",
      locationId: input.locationId,
      itemId: input.itemId,
      lotCode: input.lotCode,
      serialCode: input.serialCode,
      reason: "Recall",
      notes: query,
      createdAt: now,
    });
    await syncDocumentJob(db, {
      organizationId,
      warehouseId: input.warehouseId,
      refType: "hold",
      refId: id,
      status: "open",
      number,
      title: "Recall",
      fromLocationId: input.locationId,
      itemId: input.itemId,
      createdAt: now,
    });
    touched.add(input.itemId);
    created.push({
      id,
      number,
      locationId: input.locationId,
      locationCode: input.locationCode,
      itemId: input.itemId,
      sku: input.sku,
      lotCode: input.lotCode,
      serialCode: input.serialCode,
    });
  }

  for (const row of matchedLots) {
    if (coveringHold(open, row.locationId, row.itemId, row.lotCode)) continue;
    await insertHold({
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      locationCode: row.locationCode,
      itemId: row.itemId,
      sku: row.sku,
      lotCode: row.lotCode,
      serialCode: null,
    });
  }
  for (const row of matchedSerials) {
    if (matchingSerialHold(open, row.itemId, row.serialCode, row.locationId)) continue;
    await insertHold({
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      locationCode: row.locationCode,
      itemId: row.itemId,
      sku: row.sku,
      lotCode: null,
      serialCode: row.serialCode,
    });
  }

  if (touched.size) await scheduleShopifySellableSync(db, organizationId, [...touched]);
  return { query, created };
}
