import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import { newId } from "../lib/ids";
import { FULFILLMENT_CREATE_MUTATION, buildFulfillmentCreateInput, demoFulfillmentOrderId } from "./shopify";
import {
  ShopifyApiError,
  createShopifyGraphqlClient,
  createShopifyFulfillment,
  fetchOrderFulfillmentOrders,
} from "../lib/shopify-client";

export type ShopifyFulfillResult = {
  status: "synced" | "demo" | "failed" | "skipped";
  fulfillmentId?: string | null;
  error?: string | null;
};

async function loadOrderWithLines(db: AppDb, organizationId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) return null;
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId));
  return { ...order, lines };
}

async function recordOutbound(
  db: AppDb,
  input: {
    organizationId: string;
    orderId: string;
    kind: string;
    status: string;
    request: unknown;
    response: unknown;
  },
) {
  await db.insert(schema.shopifyOutboundEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    orderId: input.orderId,
    kind: input.kind,
    status: input.status,
    requestJson: JSON.stringify(input.request),
    responseJson: input.response == null ? null : JSON.stringify(input.response),
    createdAt: Date.now(),
  });
}

export async function fulfillShopifyOrder(
  db: AppDb,
  organizationId: string,
  orderId: string,
): Promise<ShopifyFulfillResult> {
  const order = await loadOrderWithLines(db, organizationId, orderId);
  if (!order) return { status: "skipped", error: "Order not found" };
  if (order.source !== "shopify") return { status: "skipped" };
  if (order.status !== "shipped") {
    return { status: "skipped", error: "Order must be shipped before fulfilling Shopify" };
  }
  if (order.shopifySyncStatus === "synced" && order.shopifyFulfillmentId) {
    return { status: "synced", fulfillmentId: order.shopifyFulfillmentId };
  }

  const [connection] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  if (!connection) {
    return { status: "failed", error: "Shopify is not connected" };
  }

  let fulfillmentOrderId = order.shopifyFulfillmentOrderId;
  let lineItems = order.lines
    .filter((line) => line.shopifyFulfillmentLineItemId)
    .map((line) => ({ id: line.shopifyFulfillmentLineItemId!, quantity: line.qty }));

  if (connection.mode === "live" && connection.accessToken && order.shopifyOrderGid) {
    try {
      const client = createShopifyGraphqlClient({
        shopDomain: connection.shopDomain,
        accessToken: connection.accessToken,
        apiVersion: connection.apiVersion,
      });
      const nodes = await fetchOrderFulfillmentOrders(client, order.shopifyOrderGid);
      const open = nodes.find((node) => node.status !== "closed" && node.status !== "cancelled") ?? nodes[0];
      if (open) {
        fulfillmentOrderId = open.id;
        const remaining = (open.lineItems?.nodes ?? []).filter((node) => (node.remainingQuantity ?? 0) > 0);
        if (remaining.length > 0) {
          lineItems = remaining.map((node) => ({ id: node.id, quantity: node.remainingQuantity ?? 0 }));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load fulfillment orders";
      await db
        .update(schema.orders)
        .set({ shopifySyncStatus: "failed", shopifySyncError: message })
        .where(eq(schema.orders.id, order.id));
      await recordOutbound(db, {
        organizationId,
        orderId: order.id,
        kind: "fulfillmentOrders",
        status: "failed",
        request: { orderGid: order.shopifyOrderGid },
        response: { error: message },
      });
      return { status: "failed", error: message };
    }
  }

  if (!fulfillmentOrderId) {
    fulfillmentOrderId = demoFulfillmentOrderId(order.shopifyOrderId || order.id);
  }
  if (lineItems.length === 0) {
    lineItems = order.lines.map((line) => ({
      id: line.shopifyFulfillmentLineItemId || `gid://shopify/FulfillmentOrderLineItem/demo-${line.id}`,
      quantity: line.qty,
    }));
  }

  const fulfillment = buildFulfillmentCreateInput({
    fulfillmentOrderId,
    lineItems,
    tracking: {
      number: order.trackingNumber,
      url: order.trackingUrl,
      company: order.trackingCompany,
    },
    notifyCustomer: true,
  });
  const request = { query: FULFILLMENT_CREATE_MUTATION, variables: { fulfillment } };

  if (connection.mode === "demo" || !connection.accessToken) {
    const fulfillmentId = `gid://shopify/Fulfillment/demo-${order.id}`;
    const now = Date.now();
    await db
      .update(schema.orders)
      .set({
        shopifySyncStatus: "synced",
        shopifySyncError: null,
        shopifyFulfillmentId: fulfillmentId,
        shopifyFulfillmentOrderId: fulfillmentOrderId,
        shopifyFulfilledAt: now,
      })
      .where(eq(schema.orders.id, order.id));
    await recordOutbound(db, {
      organizationId,
      orderId: order.id,
      kind: "fulfillmentCreate",
      status: "demo",
      request,
      response: { fulfillment: { id: fulfillmentId, status: "SUCCESS" }, mode: "demo" },
    });
    return { status: "demo", fulfillmentId };
  }

  try {
    const client = createShopifyGraphqlClient({
      shopDomain: connection.shopDomain,
      accessToken: connection.accessToken,
      apiVersion: connection.apiVersion,
    });
    const created = await createShopifyFulfillment(client, fulfillment as unknown as Record<string, unknown>);
    const now = Date.now();
    await db
      .update(schema.orders)
      .set({
        shopifySyncStatus: "synced",
        shopifySyncError: null,
        shopifyFulfillmentId: created.id,
        shopifyFulfillmentOrderId: fulfillmentOrderId,
        shopifyFulfilledAt: now,
      })
      .where(eq(schema.orders.id, order.id));
    await recordOutbound(db, {
      organizationId,
      orderId: order.id,
      kind: "fulfillmentCreate",
      status: "ok",
      request,
      response: created,
    });
    return { status: "synced", fulfillmentId: created.id };
  } catch (err) {
    const message = err instanceof ShopifyApiError ? err.message : err instanceof Error ? err.message : "Fulfillment failed";
    await db
      .update(schema.orders)
      .set({ shopifySyncStatus: "failed", shopifySyncError: message })
      .where(eq(schema.orders.id, order.id));
    await recordOutbound(db, {
      organizationId,
      orderId: order.id,
      kind: "fulfillmentCreate",
      status: "failed",
      request,
      response: err instanceof ShopifyApiError ? err.body : { error: message },
    });
    return { status: "failed", error: message };
  }
}
