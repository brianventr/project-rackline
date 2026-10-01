import { and, asc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { BACKORDER_SOURCE, backorderProblems, unreservedProblems } from "../../domain/exceptions/backorder";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import type { AppDb } from "../stock";
import type { ExceptionSource } from "./source";

export const backorderSource: ExceptionSource = {
  ...BACKORDER_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, warehouseId }) {
    const o = schema.orders;
    const parent = alias(schema.orders, "parent");
    const orders = await db
      .select({
        id: o.id,
        number: o.number,
        parentId: o.parentOrderId,
        parentNumber: parent.number,
        customerName: o.customerName,
        warehouseId: o.warehouseId,
        createdAt: o.createdAt,
      })
      .from(o)
      .leftJoin(parent, eq(parent.id, o.parentOrderId))
      .where(
        and(
          eq(o.organizationId, organizationId),
          eq(o.warehouseId, warehouseId),
          isNotNull(o.parentOrderId),
          notInArray(o.status, ["shipped", "cancelled"]),
        ),
      )
      .orderBy(asc(o.createdAt))
      .limit(SOURCE_LIMIT + 1);
    const shippedShort =
      orders.length === 0
        ? []
        : backorderProblems(
            await Promise.all(
              orders.map(async (row) => {
                const lines = await db
                  .select({ sku: schema.items.sku, qty: schema.orderLines.qty })
                  .from(schema.orderLines)
                  .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
                  .where(eq(schema.orderLines.orderId, row.id));
                const own = lines.filter((line) => line.qty > 0);
                return {
                  ...row,
                  units: own.reduce((sum, line) => sum + line.qty, 0),
                  skus: [...new Set(own.map((line) => line.sku))].sort(),
                };
              }),
            ),
          );
    return [...shippedShort, ...(await unreservedShortages(db, organizationId, warehouseId))];
  },
};

async function unreservedShortages(db: AppDb, organizationId: string, warehouseId: string) {
  const orders = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      customerName: schema.orders.customerName,
      warehouseId: schema.orders.warehouseId,
      createdAt: schema.orders.stockReservedAt,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.warehouseId, warehouseId),
        isNotNull(schema.orders.stockReservedAt),
        isNull(schema.orders.parentOrderId),
        inArray(schema.orders.status, ["open", "picking"]),
      ),
    )
    .orderBy(asc(schema.orders.stockReservedAt))
    .limit(SOURCE_LIMIT + 1);
  if (orders.length === 0) return [];
  const ids = orders.map((row) => row.id);
  const [lines, soft, pinned] = await Promise.all([
    db
      .select({
        orderId: schema.orderLines.orderId,
        lineId: schema.orderLines.id,
        sku: schema.items.sku,
        qty: schema.orderLines.qty,
        qtyPicked: schema.orderLines.qtyPicked,
      })
      .from(schema.orderLines)
      .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
      .where(inArray(schema.orderLines.orderId, ids)),
    db
      .select({ orderLineId: schema.softAllocations.orderLineId, qty: schema.softAllocations.qty })
      .from(schema.softAllocations)
      .where(and(inArray(schema.softAllocations.orderId, ids), eq(schema.softAllocations.status, "open"))),
    db
      .select({ orderLineId: schema.inventoryAllocations.orderLineId, qty: schema.inventoryAllocations.qty })
      .from(schema.inventoryAllocations)
      .where(and(inArray(schema.inventoryAllocations.orderId, ids), eq(schema.inventoryAllocations.status, "open"))),
  ]);
  const reservedByLine = new Map<string, number>();
  for (const row of [...soft, ...pinned]) {
    reservedByLine.set(row.orderLineId, (reservedByLine.get(row.orderLineId) ?? 0) + row.qty);
  }
  return unreservedProblems(
    orders.flatMap((order) => {
      const own = lines.filter((line) => line.orderId === order.id);
      let shortQty = 0;
      const skus: string[] = [];
      for (const line of own) {
        const short = Math.max(0, line.qty - line.qtyPicked - (reservedByLine.get(line.lineId) ?? 0));
        if (short <= 0) continue;
        shortQty += short;
        skus.push(line.sku);
      }
      if (shortQty <= 0 || order.createdAt == null) return [];
      return [{ ...order, createdAt: order.createdAt, shortQty, skus: [...new Set(skus)].sort() }];
    }),
  );
}
