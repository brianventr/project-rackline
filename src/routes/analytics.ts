import { Hono } from "hono";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import {
  buildTrafficSnapshot,
  horizonLookbackMs,
  isTrafficGrain,
  isTrafficHorizon,
} from "../domain/traffic";

export const analyticsRoute = new Hono<AppEnv>();

analyticsRoute.get("/analytics/traffic", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId") || undefined;
  const horizonRaw = c.req.query("horizon") || "now";
  const grainRaw = c.req.query("grain") || "region";
  if (!isTrafficHorizon(horizonRaw)) badRequest("horizon must be now, 7d, or 30d");
  if (!isTrafficGrain(grainRaw)) badRequest("grain must be country, region, or city");
  const skuIds = [...new URL(c.req.url).searchParams.getAll("skuIds"), ...new URL(c.req.url).searchParams.getAll("skuId")].filter(
    Boolean,
  );

  const now = Date.now();
  const lookback = now - horizonLookbackMs(horizonRaw);

  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.organizationId, organizationId),
        warehouseId ? eq(schema.warehouses.id, warehouseId) : undefined,
      ),
    );

  const orderRows = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
        inArray(schema.orders.status, ["packed", "shipped"]),
        or(eq(schema.orders.status, "packed"), gte(schema.orders.shippedAt, lookback)),
      ),
    );

  const orderIds = orderRows.map((row) => row.id);
  const lineRows =
    orderIds.length === 0
      ? []
      : await db
          .select({
            orderId: schema.orderLines.orderId,
            itemId: schema.orderLines.itemId,
            qty: schema.orderLines.qty,
            sku: schema.items.sku,
            name: schema.items.name,
          })
          .from(schema.orderLines)
          .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
          .where(inArray(schema.orderLines.orderId, orderIds));

  const linesByOrder = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }

  const snapshot = buildTrafficSnapshot({
    now,
    horizon: horizonRaw,
    grain: grainRaw,
    skuIds: skuIds.length ? skuIds : undefined,
    warehouses: warehouses.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      region: row.region,
      country: row.country,
      lat: row.lat,
      lng: row.lng,
    })),
    orders: orderRows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      warehouseId: row.warehouseId,
      packedAt: row.packedAt,
      shippedAt: row.shippedAt,
      carrierService: row.carrierService,
      trackingNumber: row.trackingNumber,
      shipToAddress: row.shipToAddress,
      shipToCity: row.shipToCity,
      shipToRegion: row.shipToRegion,
      shipToCountry: row.shipToCountry,
      shipToLat: row.shipToLat,
      shipToLng: row.shipToLng,
      lines: (linesByOrder.get(row.id) ?? []).map((line) => ({
        itemId: line.itemId,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
      })),
    })),
  });

  return c.json(snapshot);
});
