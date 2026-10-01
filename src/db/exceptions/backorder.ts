import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { BACKORDER_SOURCE, backorderProblems } from "../../domain/exceptions/backorder";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const backorderSource: ExceptionSource = {
  ...BACKORDER_SOURCE,
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
    if (orders.length === 0) return [];

    const lines = await db
      .select({ orderId: schema.orderLines.orderId, sku: schema.items.sku, qty: schema.orderLines.qty })
      .from(schema.orderLines)
      .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
      .where(
        inArray(
          schema.orderLines.orderId,
          orders.map((row) => row.id),
        ),
      );
    return backorderProblems(
      orders.map((row) => {
        const own = lines.filter((line) => line.orderId === row.id && line.qty > 0);
        return {
          ...row,
          units: own.reduce((sum, line) => sum + line.qty, 0),
          skus: [...new Set(own.map((line) => line.sku))].sort(),
        };
      }),
    );
  },
};
