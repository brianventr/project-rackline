import { and, asc, desc, eq, ne } from "drizzle-orm";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import {
  PUSH_SHOPIFY_STOCK,
  RETRY_SHOPIFY,
  SHOPIFY_SOURCE,
  shopifyFulfillmentProblems,
  shopifyStockPushProblem,
  STOCK_PUSH_EVENTS,
} from "../../domain/exceptions/shopify";
import * as schema from "../schema";
import { failedStatusError, type ExceptionSource } from "./source";

export const shopifySource: ExceptionSource = {
  ...SHOPIFY_SOURCE,
  async load({ db, organizationId, warehouseId }) {
    const o = schema.orders;
    const events = schema.shopifyOutboundEvents;
    const [orders, pushes, connection] = await Promise.all([
      db
        .select({
          id: o.id,
          number: o.number,
          shopifyOrderName: o.shopifyOrderName,
          customerName: o.customerName,
          warehouseId: o.warehouseId,
          shopifySyncError: o.shopifySyncError,
          shippedAt: o.shippedAt,
          createdAt: o.createdAt,
        })
        .from(o)
        .where(
          and(
            eq(o.organizationId, organizationId),
            eq(o.warehouseId, warehouseId),
            eq(o.shopifySyncStatus, "failed"),
            ne(o.status, "cancelled"),
          ),
        )
        .orderBy(asc(o.createdAt))
        .limit(SOURCE_LIMIT + 1),
      db
        .select({ status: events.status, responseJson: events.responseJson, createdAt: events.createdAt })
        .from(events)
        .where(and(eq(events.organizationId, organizationId), eq(events.kind, "inventorySetQuantities")))
        .orderBy(desc(events.createdAt))
        .limit(STOCK_PUSH_EVENTS),
      db
        .select({ id: schema.shopifyConnections.id })
        .from(schema.shopifyConnections)
        .where(eq(schema.shopifyConnections.organizationId, organizationId))
        .limit(1),
    ]);
    const push = connection.length ? shopifyStockPushProblem(pushes) : null;
    return [...shopifyFulfillmentProblems(orders), ...(push ? [push] : [])];
  },
  action(item, actionId) {
    if (actionId === RETRY_SHOPIFY.id && item.orderId) {
      return {
        path: `/orders/${item.orderId}/shopify/fulfill`,
        failure: (result) => {
          const shopify = result.body.shopify as { status?: unknown; error?: unknown } | undefined;
          const error = typeof shopify?.error === "string" && shopify.error ? shopify.error : null;
          if (shopify?.status === "failed") return error ?? "Shopify refused the fulfillment again.";
          if (shopify?.status === "skipped" && error) return error;
          return result.ok ? null : result.error;
        },
      };
    }
    if (actionId === PUSH_SHOPIFY_STOCK.id) return { path: "/shopify/inventory/sync", body: {}, failure: failedStatusError };
    return null;
  },
};
