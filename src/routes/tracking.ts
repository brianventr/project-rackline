import { Hono } from "hono";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { conflict, notFound } from "../lib/http";
import { loadPackagesForOrders } from "../db/packages";
import { isPublicToken, newPublicToken, publicLink, trackingPagePath } from "../domain/public-token";
import { publicTrackingView, type TrackerReceipt } from "../domain/tracking-page";

/** The customer's tracking page. Anyone with the link may read it, so it answers 404 for every miss. */
export const trackingPublicRoute = new Hono<AppEnv>();

trackingPublicRoute.get("/track/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  const token = c.req.param("token");
  if (!isPublicToken(token)) return c.json({ error: "Not found" }, 404);
  const db = c.get("db");
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.trackingToken, token)).limit(1);
  if (!order) return c.json({ error: "Not found" }, 404);

  const [org] = await db
    .select({ name: schema.organizations.name, brandColor: schema.organizations.brandColor, logoUrl: schema.organizations.logoUrl })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, order.organizationId))
    .limit(1);
  const lines = await db
    .select({ name: schema.items.name, qty: schema.orderLines.qty })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, order.id));
  const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];

  const trackingNumbers = [
    ...new Set([order.trackingNumber, ...packages.map((row) => row.trackingNumber)].filter((row): row is string => Boolean(row))),
  ];
  const receiptsByTracking = new Map<string, TrackerReceipt[]>();
  if (trackingNumbers.length > 0) {
    const receipts = await db
      .select({
        trackingNumber: schema.trackerWebhookReceipts.trackingNumber,
        payloadJson: schema.trackerWebhookReceipts.payloadJson,
        createdAt: schema.trackerWebhookReceipts.createdAt,
      })
      .from(schema.trackerWebhookReceipts)
      .where(
        and(
          eq(schema.trackerWebhookReceipts.organizationId, order.organizationId),
          inArray(schema.trackerWebhookReceipts.trackingNumber, trackingNumbers),
        ),
      )
      .orderBy(asc(schema.trackerWebhookReceipts.createdAt));
    for (const row of receipts) {
      if (!row.trackingNumber) continue;
      const list = receiptsByTracking.get(row.trackingNumber) ?? [];
      list.push(row);
      receiptsByTracking.set(row.trackingNumber, list);
    }
  }

  return c.json(
    publicTrackingView({
      shop: { name: org?.name ?? "", brandColor: org?.brandColor ?? null, logoUrl: org?.logoUrl ?? null },
      order,
      packages: packages.map((pkg) => ({
        ...pkg,
        items: pkg.lines.map((line) => ({ name: line.itemName, qty: line.qty })),
      })),
      items: lines,
      receiptsByTracking,
    }),
  );
});

export const trackingRoute = new Hono<AppEnv>();

/** The customer's tracking link for an order, minted the first time someone asks for it. */
trackingRoute.post("/orders/:id/tracking-link", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const [order] = await db
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      trackingToken: schema.orders.trackingToken,
      trackingNumber: schema.orders.trackingNumber,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) notFound("Order not found");
  let token = order.trackingToken;
  if (!token) {
    const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
    const tracked = order.trackingNumber || packages.some((row) => row.trackingNumber || row.shippedAt);
    if (order.status !== "shipped" && !tracked) {
      conflict("This order has not shipped and has no label yet. Ship it or buy its label first.");
    }
    await db
      .update(schema.orders)
      .set({ trackingToken: newPublicToken() })
      .where(and(eq(schema.orders.id, order.id), isNull(schema.orders.trackingToken)));
    const [row] = await db
      .select({ trackingToken: schema.orders.trackingToken })
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id))
      .limit(1);
    token = row?.trackingToken ?? null;
  }
  if (!token) notFound("Order not found");
  const path = trackingPagePath(token);
  return c.json({ token, path, url: publicLink(c.get("origin"), path) });
});
