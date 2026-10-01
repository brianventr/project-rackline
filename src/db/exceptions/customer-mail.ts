import { and, asc, eq, gte, or } from "drizzle-orm";
import { CUSTOMER_MAIL_SOURCE, CUSTOMER_MAIL_WINDOW_MS, customerMailProblems, customerMailResendPath, RESEND_CUSTOMER_MAIL } from "../../domain/exceptions/customer-mail";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import { failedStatusError, type ExceptionSource } from "./source";

export const customerMailSource: ExceptionSource = {
  ...CUSTOMER_MAIL_SOURCE,
  async load({ db, organizationId, warehouseId, now }) {
    const e = schema.customerEmails;
    const o = schema.orders;
    const r = schema.rmas;
    const rows = await db
      .select({
        orderId: e.orderId,
        rmaId: e.rmaId,
        event: e.event,
        status: e.status,
        reason: e.reason,
        orderNumber: o.number,
        rmaNumber: r.number,
        orderWarehouseId: o.warehouseId,
        rmaWarehouseId: r.warehouseId,
        updatedAt: e.updatedAt,
      })
      .from(e)
      .leftJoin(o, eq(o.id, e.orderId))
      .leftJoin(r, eq(r.id, e.rmaId))
      .where(
        and(
          eq(e.organizationId, organizationId),
          eq(e.status, "failed"),
          gte(e.updatedAt, now - CUSTOMER_MAIL_WINDOW_MS),
          or(eq(o.warehouseId, warehouseId), eq(r.warehouseId, warehouseId)),
        ),
      )
      .orderBy(asc(e.updatedAt))
      .limit(SOURCE_LIMIT + 1);
    return customerMailProblems(
      rows.map((row) => ({
        orderId: row.orderId,
        rmaId: row.rmaId,
        event: row.event,
        status: row.status,
        reason: row.reason,
        orderNumber: row.orderNumber,
        rmaNumber: row.rmaNumber,
        warehouseId: row.orderWarehouseId ?? row.rmaWarehouseId,
        updatedAt: row.updatedAt,
      })),
    );
  },
  action(item, actionId) {
    if (actionId !== RESEND_CUSTOMER_MAIL.id) return null;
    const path = customerMailResendPath(item.key);
    if (!path) return null;
    return { path, failure: failedStatusError };
  },
};
