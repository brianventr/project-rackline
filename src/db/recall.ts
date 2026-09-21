import { and, eq, inArray, or, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { expandRecallCodes, movementMatchesRecall, orderIsOpen } from "../domain/recall";

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
