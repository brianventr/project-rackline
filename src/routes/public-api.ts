import { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  decodePageCursor,
  encodePageCursor,
  pageOf,
  parsePageLimit,
  storedScopes,
  type ApiScope,
} from "../domain/public-api";
import { badRequest, forbidden, unauthorized } from "../lib/http";
import { lookupWarranty } from "../db/warranty";
import { gorgiasWarrantyPayload } from "../domain/gorgias";
import { secretFingerprint } from "../lib/secret-box";
import type { AppEnv } from "../lib/types";

/** Read API. Bearer key only; mounted outside the browser session. */
export const publicApiRoute = new Hono<AppEnv>();

async function requireKey(c: { req: { header(name: string): string | undefined }; get(key: "db"): AppEnv["Variables"]["db"] }, scope: ApiScope) {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match?.[1]) unauthorized();
  const hash = await secretFingerprint(match[1]);
  const [key] = await c.get("db").select().from(schema.apiKeys).where(eq(schema.apiKeys.secretHash, hash)).limit(1);
  if (!key || key.revokedAt != null) unauthorized();
  if (!storedScopes(key.scopes).includes(scope)) forbidden();
  return key.organizationId;
}

publicApiRoute.get("/v1/orders", async (c) => {
  const organizationId = await requireKey(c, "orders:read");
  const db = c.get("db");
  const limit = parsePageLimit(c.req.query("limit"));
  const cursorRaw = c.req.query("cursor");
  let cursor: { createdAt: number; number: string } | null = null;
  if (cursorRaw) {
    const parts = decodePageCursor(cursorRaw, 2);
    const createdAt = parts ? Number(parts[0]) : NaN;
    if (!parts || !Number.isFinite(createdAt)) badRequest("Invalid cursor");
    cursor = { createdAt, number: parts[1]! };
  }
  const rows = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      status: schema.orders.status,
      createdAt: schema.orders.createdAt,
      city: schema.orders.shipToCity,
      customerName: schema.orders.customerName,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        cursor
          ? or(
              lt(schema.orders.createdAt, cursor.createdAt),
              and(eq(schema.orders.createdAt, cursor.createdAt), lt(schema.orders.number, cursor.number)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.orders.createdAt), desc(schema.orders.number))
    .limit(limit + 1);
  const { page, more } = pageOf(rows, limit);
  const lineRows =
    page.length === 0
      ? []
      : await db
          .select({
            orderId: schema.orderLines.orderId,
            sku: schema.items.sku,
            qty: schema.orderLines.qty,
          })
          .from(schema.orderLines)
          .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
          .where(
            inArray(
              schema.orderLines.orderId,
              page.map((row) => row.id),
            ),
          );
  const linesByOrder = new Map<string, { sku: string; qty: number }[]>();
  for (const line of lineRows) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push({ sku: line.sku, qty: line.qty });
    linesByOrder.set(line.orderId, list);
  }
  const last = page[page.length - 1];
  return c.json({
    orders: page.map((row) => ({
      number: row.number,
      status: row.status,
      createdAt: row.createdAt,
      customerName: row.customerName,
      city: row.city,
      lines: linesByOrder.get(row.id) ?? [],
    })),
    nextCursor: more && last ? encodePageCursor([String(last.createdAt), last.number]) : null,
  });
});

publicApiRoute.get("/v1/stock", async (c) => {
  const organizationId = await requireKey(c, "stock:read");
  const db = c.get("db");
  const limit = parsePageLimit(c.req.query("limit"));
  const cursorRaw = c.req.query("cursor");
  let cursorSku: string | null = null;
  if (cursorRaw) {
    const parts = decodePageCursor(cursorRaw, 1);
    if (!parts) badRequest("Invalid cursor");
    cursorSku = parts[0]!;
  }
  const rows = await db
    .select({
      sku: schema.items.sku,
      name: schema.items.name,
      qty: sql<number>`sum(${schema.inventoryBalances.qty})`,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(and(eq(schema.inventoryBalances.organizationId, organizationId), cursorSku ? gt(schema.items.sku, cursorSku) : undefined))
    .groupBy(schema.items.sku, schema.items.name)
    .having(sql`sum(${schema.inventoryBalances.qty}) > 0`)
    .orderBy(schema.items.sku)
    .limit(limit + 1);
  const { page, more } = pageOf(rows, limit);
  const last = page[page.length - 1];
  return c.json({
    stock: page.map((row) => ({ sku: row.sku, name: row.name, qty: Number(row.qty) || 0 })),
    nextCursor: more && last ? encodePageCursor([last.sku]) : null,
  });
});

publicApiRoute.get("/v1/shipments", async (c) => {
  const organizationId = await requireKey(c, "shipments:read");
  const db = c.get("db");
  const limit = parsePageLimit(c.req.query("limit"));
  const cursorRaw = c.req.query("cursor");
  let cursor: { shippedAt: number; number: string } | null = null;
  if (cursorRaw) {
    const parts = decodePageCursor(cursorRaw, 2);
    const shippedAt = parts ? Number(parts[0]) : NaN;
    if (!parts || !Number.isFinite(shippedAt)) badRequest("Invalid cursor");
    cursor = { shippedAt, number: parts[1]! };
  }
  const rows = await db
    .select({
      number: schema.orders.number,
      shippedAt: schema.orders.shippedAt,
      carrier: schema.orders.trackingCompany,
      service: schema.orders.carrierService,
      trackingNumber: schema.orders.trackingNumber,
      trackerStatus: schema.orders.trackerStatus,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.status, "shipped"),
        isNotNull(schema.orders.shippedAt),
        cursor
          ? or(
              lt(schema.orders.shippedAt, cursor.shippedAt),
              and(eq(schema.orders.shippedAt, cursor.shippedAt), lt(schema.orders.number, cursor.number)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.orders.shippedAt), desc(schema.orders.number))
    .limit(limit + 1);
  const { page, more } = pageOf(rows, limit);
  const last = page[page.length - 1];
  return c.json({
    shipments: page.map((row) => ({
      orderNumber: row.number,
      carrier: row.carrier || row.service,
      trackingNumber: row.trackingNumber,
      status: row.trackerStatus || "shipped",
    })),
    nextCursor: more && last?.shippedAt != null ? encodePageCursor([String(last.shippedAt), last.number]) : null,
  });
});

/** Gorgias HTTP widget. The ticket URL passes the customer email; the key is orders:read. */
publicApiRoute.get("/v1/warranty", async (c) => {
  const organizationId = await requireKey(c, "orders:read");
  const email = c.req.query("email")?.trim() ?? "";
  if (!email) badRequest("email is required");
  const matches = await lookupWarranty(c.get("db"), organizationId, email);
  return c.json(gorgiasWarrantyPayload(matches));
});
