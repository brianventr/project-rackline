import { and, eq } from "drizzle-orm";
import { SERIAL_SOURCE, serialProblems } from "../../domain/exceptions/serials";
import { reconcileSerials } from "../../domain/warranty";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const serialSource: ExceptionSource = {
  ...SERIAL_SOURCE,
  loadLimit: null,
  async load({ db, organizationId, warehouseId }) {
    const lines = await db
      .select({
        orderId: schema.orders.id,
        orderNumber: schema.orders.number,
        lineId: schema.orderLines.id,
        sku: schema.items.sku,
        qty: schema.orderLines.qty,
        warehouseId: schema.orders.warehouseId,
      })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          eq(schema.orders.status, "shipped"),
          eq(schema.items.trackSerial, true),
        ),
      );
    const assignments = await db
      .select({
        serial: schema.serials.serialCode,
        orderId: schema.serialAssignments.orderId,
        lineId: schema.serialAssignments.orderLineId,
      })
      .from(schema.serialAssignments)
      .innerJoin(schema.serials, eq(schema.serials.id, schema.serialAssignments.serialId))
      .innerJoin(schema.orders, eq(schema.orders.id, schema.serialAssignments.orderId))
      .where(and(eq(schema.serialAssignments.organizationId, organizationId), eq(schema.orders.warehouseId, warehouseId)));
    const orphans = await db
      .select({ serial: schema.serials.serialCode })
      .from(schema.serials)
      .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.status, "shipped")));
    const assigned = new Set(assignments.map((row) => row.serial.toUpperCase()));
    const problems = reconcileSerials({
      lines,
      assignments,
      shippedWithoutOrder: orphans
        .filter((row) => !assigned.has(row.serial.toUpperCase()))
        .map((row) => ({ serial: row.serial, warehouseId })),
    });
    return serialProblems(problems);
  },
};
