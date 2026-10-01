import { Hono } from "hono";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { clientPortalBody } from "../domain/client-portal";
import { isPublicToken } from "../domain/public-token";
import type { AppEnv } from "../lib/types";

/** Public read-only client portal. No session. */
export const portalPublicRoute = new Hono<AppEnv>();

portalPublicRoute.get("/portal/c/:token", async (c) => {
  const token = c.req.param("token");
  if (!isPublicToken(token)) return c.json({ error: "Not found" }, 404);
  const db = c.get("db");
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.portalToken, token)).limit(1);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, client.organizationId))
    .limit(1);

  const [stock, orders, shipments, invoices] = await Promise.all([
    db
      .select({
        sku: schema.items.sku,
        name: schema.items.name,
        qty: sql<number>`coalesce(sum(${schema.clientBalances.qty}), 0)`,
      })
      .from(schema.clientBalances)
      .innerJoin(schema.items, eq(schema.items.id, schema.clientBalances.itemId))
      .where(and(eq(schema.clientBalances.organizationId, client.organizationId), eq(schema.clientBalances.clientId, client.id)))
      .groupBy(schema.items.sku, schema.items.name)
      .orderBy(schema.items.sku),
    db
      .select({
        number: schema.orders.number,
        status: schema.orders.status,
        shipToCity: schema.orders.shipToCity,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, client.organizationId),
          eq(schema.orders.clientId, client.id),
          notInArray(schema.orders.status, ["shipped", "cancelled"]),
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(50),
    db
      .select({
        orderNumber: schema.orders.number,
        carrier: schema.orders.trackingCompany,
        service: schema.orders.carrierService,
        trackingNumber: schema.orders.trackingNumber,
        status: schema.orders.trackerStatus,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, client.organizationId),
          eq(schema.orders.clientId, client.id),
          eq(schema.orders.status, "shipped"),
        ),
      )
      .orderBy(desc(schema.orders.shippedAt))
      .limit(20),
    db
      .select({
        number: schema.invoices.number,
        amountCents: schema.invoices.amountCents,
        status: schema.invoices.status,
        periodStart: schema.invoices.periodStart,
        periodEnd: schema.invoices.periodEnd,
        linesJson: schema.invoices.linesJson,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.organizationId, client.organizationId), eq(schema.invoices.clientId, client.id)))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(20),
  ]);

  return c.json(
    clientPortalBody({
      organizationName: org?.name ?? "Warehouse",
      clientCode: client.code,
      clientName: client.name,
      stock: stock.map((row) => ({ sku: row.sku, name: row.name, qty: Number(row.qty) || 0 })),
      orders,
      shipments: shipments.map((row) => ({
        orderNumber: row.orderNumber,
        carrier: row.carrier || row.service,
        trackingNumber: row.trackingNumber,
        status: row.status,
      })),
      invoices,
    }),
  );
});
