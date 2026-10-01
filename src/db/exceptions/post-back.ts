import { and, asc, eq, inArray } from "drizzle-orm";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import { POST_BACK_SOURCE, postBackProblems, RETRY_POST_BACK } from "../../domain/exceptions/post-back";
import * as schema from "../schema";
import { failedStatusError, type ExceptionSource } from "./source";

export const postBackSource: ExceptionSource = {
  ...POST_BACK_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, warehouseId }) {
    const o = schema.orders;
    const rows = await db
      .select({
        id: o.id,
        number: o.number,
        source: o.source,
        status: o.status,
        channelSyncStatus: o.channelSyncStatus,
        channelSyncError: o.channelSyncError,
        customerName: o.customerName,
        warehouseId: o.warehouseId,
        shippedAt: o.shippedAt,
        createdAt: o.createdAt,
      })
      .from(o)
      .where(
        and(
          eq(o.organizationId, organizationId),
          eq(o.warehouseId, warehouseId),
          eq(o.status, "shipped"),
          eq(o.channelSyncStatus, "failed"),
          inArray(o.source, ["woocommerce", "etsy"]),
        ),
      )
      .orderBy(asc(o.shippedAt))
      .limit(SOURCE_LIMIT + 1);
    return postBackProblems(rows);
  },
  action(item, actionId) {
    if (actionId !== RETRY_POST_BACK.id || !item.orderId) return null;
    return { path: `/channels/orders/${item.orderId}/post-back`, failure: failedStatusError };
  },
};
