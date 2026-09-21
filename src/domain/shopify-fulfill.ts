import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import { newId } from "../lib/ids";
import {
  FULFILLMENT_CREATE_MUTATION,
  buildFulfillmentCreateInput,
  demoFulfillmentOrderId,
  fulfillmentLineItemsForPackage,
} from "./shopify";
import { loadPackagesForOrders, type OrderPackageRow } from "../db/packages";
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

type OrderWithLines = NonNullable<Awaited<ReturnType<typeof loadOrderWithLines>>>;
type ShopifyConnectionRow = typeof schema.shopifyConnections.$inferSelect;

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

async function resolveFulfillmentOrder(
  db: AppDb,
  organizationId: string,
  order: OrderWithLines,
  connection: ShopifyConnectionRow,
): Promise<{ fulfillmentOrderId: string | null; error?: string }> {
  let fulfillmentOrderId = order.shopifyFulfillmentOrderId;
  if (connection.mode === "live" && connection.accessToken && order.shopifyOrderGid) {
    try {
      const client = createShopifyGraphqlClient({
        shopDomain: connection.shopDomain,
        accessToken: connection.accessToken,
        apiVersion: connection.apiVersion,
      });
      const nodes = await fetchOrderFulfillmentOrders(client, order.shopifyOrderGid);
      const open = nodes.find((node) => node.status !== "closed" && node.status !== "cancelled") ?? nodes[0];
      if (open) fulfillmentOrderId = open.id;
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
      return { fulfillmentOrderId: null, error: message };
    }
  }
  return { fulfillmentOrderId };
}

async function postFulfillmentCreate(
  db: AppDb,
  input: {
    organizationId: string;
    order: OrderWithLines;
    connection: ShopifyConnectionRow;
    fulfillmentOrderId: string;
    lineItems: Array<{ id: string; quantity: number }>;
    packages: Array<{ trackingNumber?: string | null; trackingUrl?: string | null; trackingCompany?: string | null }>;
    tracking?: { number?: string | null; url?: string | null; company?: string | null };
    packageId?: string;
    demoSuffix?: string;
    orderComplete: boolean;
  },
): Promise<ShopifyFulfillResult> {
  const fulfillment = buildFulfillmentCreateInput({
    fulfillmentOrderId: input.fulfillmentOrderId,
    lineItems: input.lineItems,
    tracking: input.tracking,
    packages: input.packages,
    notifyCustomer: true,
  });
  const request = { query: FULFILLMENT_CREATE_MUTATION, variables: { fulfillment } };
  const now = Date.now();

  if (input.connection.mode === "demo" || !input.connection.accessToken) {
    const fulfillmentId = `gid://shopify/Fulfillment/demo-${input.demoSuffix ?? input.order.id}`;
    if (input.packageId) {
      await db
        .update(schema.orderPackages)
        .set({ shopifyFulfillmentId: fulfillmentId })
        .where(eq(schema.orderPackages.id, input.packageId));
    }
    await db
      .update(schema.orders)
      .set({
        shopifySyncStatus: input.orderComplete ? "synced" : "pending_fulfill",
        shopifySyncError: null,
        shopifyFulfillmentId: fulfillmentId,
        shopifyFulfillmentOrderId: input.fulfillmentOrderId,
        shopifyFulfilledAt: input.orderComplete ? now : input.order.shopifyFulfilledAt,
      })
      .where(eq(schema.orders.id, input.order.id));
    await recordOutbound(db, {
      organizationId: input.organizationId,
      orderId: input.order.id,
      kind: "fulfillmentCreate",
      status: "demo",
      request,
      response: {
        fulfillment: { id: fulfillmentId, status: "SUCCESS" },
        mode: "demo",
        packageId: input.packageId ?? null,
      },
    });
    return { status: "demo", fulfillmentId };
  }

  try {
    const client = createShopifyGraphqlClient({
      shopDomain: input.connection.shopDomain,
      accessToken: input.connection.accessToken,
      apiVersion: input.connection.apiVersion,
    });
    const created = await createShopifyFulfillment(client, fulfillment as unknown as Record<string, unknown>);
    if (input.packageId) {
      await db
        .update(schema.orderPackages)
        .set({ shopifyFulfillmentId: created.id })
        .where(eq(schema.orderPackages.id, input.packageId));
    }
    await db
      .update(schema.orders)
      .set({
        shopifySyncStatus: input.orderComplete ? "synced" : "pending_fulfill",
        shopifySyncError: null,
        shopifyFulfillmentId: created.id,
        shopifyFulfillmentOrderId: input.fulfillmentOrderId,
        shopifyFulfilledAt: input.orderComplete ? now : input.order.shopifyFulfilledAt,
      })
      .where(eq(schema.orders.id, input.order.id));
    await recordOutbound(db, {
      organizationId: input.organizationId,
      orderId: input.order.id,
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
      .where(eq(schema.orders.id, input.order.id));
    await recordOutbound(db, {
      organizationId: input.organizationId,
      orderId: input.order.id,
      kind: "fulfillmentCreate",
      status: "failed",
      request,
      response: err instanceof ShopifyApiError ? err.body : { error: message },
    });
    return { status: "failed", error: message };
  }
}

function orderCompleteAfterPackages(orderStatus: string, packages: OrderPackageRow[]): boolean {
  if (orderStatus !== "shipped") return false;
  const shipped = packages.filter((row) => row.shippedAt);
  if (shipped.length === 0) return true;
  return shipped.every((row) => Boolean(row.shopifyFulfillmentId));
}

async function loadShopifyChannel(db: AppDb, organizationId: string, order: OrderWithLines): Promise<OrderWithLines> {
  let current = order;
  const seen = new Set<string>();
  while (!current.shopifyOrderGid && !current.shopifyFulfillmentOrderId && current.parentOrderId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = await loadOrderWithLines(db, organizationId, current.parentOrderId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export async function fulfillShopifyOrder(
  db: AppDb,
  organizationId: string,
  orderId: string,
  options?: { packageId?: string },
): Promise<ShopifyFulfillResult> {
  const order = await loadOrderWithLines(db, organizationId, orderId);
  if (!order) return { status: "skipped", error: "Order not found" };
  const channel = await loadShopifyChannel(db, organizationId, order);
  if (order.source !== "shopify" && channel.source !== "shopify") return { status: "skipped" };

  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
  const target = options?.packageId ? packages.find((row) => row.id === options.packageId) : null;
  if (options?.packageId && !target) return { status: "skipped", error: "Carton not found" };

  if (!target && packages.length === 0) {
    if (order.status !== "shipped") {
      return { status: "skipped", error: "Order must be shipped before fulfilling Shopify" };
    }
    if (order.shopifySyncStatus === "synced" && order.shopifyFulfillmentId) {
      return { status: "synced", fulfillmentId: order.shopifyFulfillmentId };
    }
  }

  if (target?.shopifyFulfillmentId) {
    return { status: "synced", fulfillmentId: target.shopifyFulfillmentId };
  }
  if (target && !target.shippedAt) {
    return { status: "skipped", error: "Ship the carton before fulfilling Shopify" };
  }

  const [connection] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  if (!connection) {
    return { status: "failed", error: "Shopify is not connected" };
  }

  const resolved = await resolveFulfillmentOrder(db, organizationId, channel, connection);
  if (resolved.error) return { status: "failed", error: resolved.error };
  const fulfillmentOrderId = resolved.fulfillmentOrderId || demoFulfillmentOrderId(channel.shopifyOrderId || order.shopifyOrderId || channel.id);

  if (target) {
    const lineItems = fulfillmentLineItemsForPackage(order.lines, target.lines);
    const result = await postFulfillmentCreate(db, {
      organizationId,
      order,
      connection,
      fulfillmentOrderId,
      lineItems,
      packages: [target],
      tracking: {
        number: target.trackingNumber,
        url: target.trackingUrl,
        company: target.trackingCompany,
      },
      packageId: target.id,
      demoSuffix: `${order.id}-${target.id}`,
      orderComplete: false,
    });
    if (result.status === "failed") return result;
    const nextPackages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
    const complete = orderCompleteAfterPackages(order.status, nextPackages);
    if (complete) {
      await db
        .update(schema.orders)
        .set({
          shopifySyncStatus: result.status === "demo" ? "synced" : result.status,
          shopifyFulfilledAt: Date.now(),
        })
        .where(eq(schema.orders.id, order.id));
    }
    return result;
  }

  const shippedUnfulfilled = packages.filter((row) => row.shippedAt && !row.shopifyFulfillmentId);
  if (packages.length > 0) {
    if (shippedUnfulfilled.length === 0) {
      if (order.shopifySyncStatus === "synced" && order.shopifyFulfillmentId) {
        return { status: "synced", fulfillmentId: order.shopifyFulfillmentId };
      }
      return { status: "skipped", error: "No shipped cartons remaining to fulfill" };
    }
    let last: ShopifyFulfillResult = { status: "skipped" };
    for (const pkg of shippedUnfulfilled) {
      last = await fulfillShopifyOrder(db, organizationId, orderId, { packageId: pkg.id });
      if (last.status === "failed") return last;
    }
    return last;
  }

  let lineItems = order.lines
    .filter((line) => line.shopifyFulfillmentLineItemId)
    .map((line) => ({ id: line.shopifyFulfillmentLineItemId!, quantity: line.qty }));
  if (lineItems.length === 0) {
    lineItems = order.lines.map((line) => ({
      id: line.shopifyFulfillmentLineItemId || `gid://shopify/FulfillmentOrderLineItem/demo-${line.id}`,
      quantity: line.qty,
    }));
  }

  return postFulfillmentCreate(db, {
    organizationId,
    order,
    connection,
    fulfillmentOrderId,
    lineItems,
    packages: [],
    tracking: {
      number: order.trackingNumber,
      url: order.trackingUrl,
      company: order.trackingCompany,
    },
    orderComplete: true,
  });
}
