import { Hono } from "hono";
import { and, eq, like, or } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireString } from "../lib/http";

export const searchRoute = new Hono<AppEnv>();

searchRoute.get("/search", async (c) => {
  const q = requireString(c.req.query("q"), "q");
  const needle = `%${q.replaceAll("%", "").replaceAll("_", "")}%`;
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;

  const [items, locations, orders, receipts, transfers, workOrders, counts, purchases, returns, vendorReturns, replenishments, kits, holds, waves, asns, yard, equipment, serials] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        sku: schema.items.sku,
        name: schema.items.name,
        barcode: schema.items.barcode,
        type: schema.items.type,
      })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.organizationId, organizationId),
          or(like(schema.items.sku, needle), like(schema.items.name, needle), like(schema.items.barcode, needle)),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.locations.id,
        code: schema.locations.code,
        name: schema.locations.name,
        barcode: schema.locations.barcode,
        type: schema.locations.type,
      })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.organizationId, organizationId),
          or(
            like(schema.locations.code, needle),
            like(schema.locations.name, needle),
            like(schema.locations.barcode, needle),
          ),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
        source: schema.orders.source,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          or(
            like(schema.orders.number, needle),
            like(schema.orders.customerName, needle),
            like(schema.orders.shopifyOrderName, needle),
          ),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.receipts.id,
        number: schema.receipts.number,
        status: schema.receipts.status,
        notes: schema.receipts.notes,
      })
      .from(schema.receipts)
      .where(
        and(
          eq(schema.receipts.organizationId, organizationId),
          or(like(schema.receipts.number, needle), like(schema.receipts.notes, needle)),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.transfers.id,
        number: schema.transfers.number,
        status: schema.transfers.status,
      })
      .from(schema.transfers)
      .where(and(eq(schema.transfers.organizationId, organizationId), like(schema.transfers.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.workOrders.id,
        number: schema.workOrders.number,
        status: schema.workOrders.status,
      })
      .from(schema.workOrders)
      .where(and(eq(schema.workOrders.organizationId, organizationId), like(schema.workOrders.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.cycleCounts.id,
        number: schema.cycleCounts.number,
        status: schema.cycleCounts.status,
      })
      .from(schema.cycleCounts)
      .where(and(eq(schema.cycleCounts.organizationId, organizationId), like(schema.cycleCounts.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.purchases.id,
        number: schema.purchases.number,
        vendorName: schema.purchases.vendorName,
        status: schema.purchases.status,
      })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.organizationId, organizationId),
          or(like(schema.purchases.number, needle), like(schema.purchases.vendorName, needle)),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.rmas.id,
        number: schema.rmas.number,
        customerName: schema.rmas.customerName,
        status: schema.rmas.status,
      })
      .from(schema.rmas)
      .where(
        and(
          eq(schema.rmas.organizationId, organizationId),
          or(like(schema.rmas.number, needle), like(schema.rmas.customerName, needle)),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.vendorReturns.id,
        number: schema.vendorReturns.number,
        vendorName: schema.vendorReturns.vendorName,
        status: schema.vendorReturns.status,
      })
      .from(schema.vendorReturns)
      .where(
        and(
          eq(schema.vendorReturns.organizationId, organizationId),
          or(like(schema.vendorReturns.number, needle), like(schema.vendorReturns.vendorName, needle)),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.replenishments.id,
        number: schema.replenishments.number,
        status: schema.replenishments.status,
      })
      .from(schema.replenishments)
      .where(and(eq(schema.replenishments.organizationId, organizationId), like(schema.replenishments.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.kitBuilds.id,
        number: schema.kitBuilds.number,
        status: schema.kitBuilds.status,
      })
      .from(schema.kitBuilds)
      .where(and(eq(schema.kitBuilds.organizationId, organizationId), like(schema.kitBuilds.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.inventoryHolds.id,
        number: schema.inventoryHolds.number,
        status: schema.inventoryHolds.status,
      })
      .from(schema.inventoryHolds)
      .where(and(eq(schema.inventoryHolds.organizationId, organizationId), like(schema.inventoryHolds.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.waves.id,
        number: schema.waves.number,
        status: schema.waves.status,
      })
      .from(schema.waves)
      .where(and(eq(schema.waves.organizationId, organizationId), like(schema.waves.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.asns.id,
        number: schema.asns.number,
        status: schema.asns.status,
        vendorName: schema.asns.vendorName,
      })
      .from(schema.asns)
      .where(and(eq(schema.asns.organizationId, organizationId), like(schema.asns.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.yardVisits.id,
        number: schema.yardVisits.number,
        status: schema.yardVisits.status,
        carrierName: schema.yardVisits.carrierName,
      })
      .from(schema.yardVisits)
      .where(and(eq(schema.yardVisits.organizationId, organizationId), like(schema.yardVisits.number, needle)))
      .limit(8),
    db
      .select({
        id: schema.equipment.id,
        code: schema.equipment.code,
        name: schema.equipment.name,
        barcode: schema.equipment.barcode,
        status: schema.equipment.status,
        class: schema.equipment.class,
      })
      .from(schema.equipment)
      .where(
        and(
          eq(schema.equipment.organizationId, organizationId),
          or(
            like(schema.equipment.code, needle),
            like(schema.equipment.name, needle),
            like(schema.equipment.barcode, needle),
          ),
        ),
      )
      .limit(8),
    db
      .select({
        serialCode: schema.serials.serialCode,
        itemId: schema.serials.itemId,
        sku: schema.items.sku,
        status: schema.serials.status,
      })
      .from(schema.serials)
      .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
      .where(and(eq(schema.serials.organizationId, organizationId), like(schema.serials.serialCode, needle)))
      .limit(8),
  ]);

  return c.json({
    q,
    items,
    locations,
    orders,
    receipts,
    transfers,
    workOrders,
    counts,
    purchases,
    returns,
    vendorReturns,
    replenishments,
    kits,
    holds,
    waves,
    asns,
    yard,
    equipment,
    serials,
  });
});
