import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { rankScheduleJobs, toScheduleJob } from "../domain/schedule";

export const scheduleRoute = new Hono<AppEnv>();

scheduleRoute.get("/schedule", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId") || undefined;
  const now = Date.now();

  const kitWhere = [eq(schema.kitBuilds.organizationId, organizationId)];
  if (warehouseId) kitWhere.push(eq(schema.kitBuilds.warehouseId, warehouseId));
  const kits = await db
    .select({
      id: schema.kitBuilds.id,
      number: schema.kitBuilds.number,
      status: schema.kitBuilds.status,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
      createdAt: schema.kitBuilds.createdAt,
      itemId: schema.kitBuilds.itemId,
      sku: schema.items.sku,
      name: schema.items.name,
    })
    .from(schema.kitBuilds)
    .innerJoin(schema.items, eq(schema.items.id, schema.kitBuilds.itemId))
    .where(and(...kitWhere))
    .limit(200);

  const woWhere = [eq(schema.workOrders.organizationId, organizationId)];
  if (warehouseId) woWhere.push(eq(schema.workOrders.warehouseId, warehouseId));
  const workOrders = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      status: schema.workOrders.status,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
      createdAt: schema.workOrders.createdAt,
      itemId: schema.workOrders.itemId,
      sku: schema.items.sku,
      name: schema.items.name,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(and(...woWhere))
    .limit(200);

  const jobs = rankScheduleJobs(
    [
      ...kits.map((row) =>
        toScheduleJob({
          id: row.id,
          kind: "kit",
          number: row.number,
          sku: row.sku,
          name: row.name,
          qty: row.qty,
          qtyCompleted: row.qtyCompleted ?? 0,
          status: row.status,
          createdAt: row.createdAt,
          now,
        }),
      ),
      ...workOrders.map((row) =>
        toScheduleJob({
          id: row.id,
          kind: "work_order",
          number: row.number,
          sku: row.sku,
          name: row.name,
          qty: row.qty,
          qtyCompleted: row.qtyCompleted ?? 0,
          status: row.status,
          createdAt: row.createdAt,
          now,
        }),
      ),
    ].filter((job): job is NonNullable<typeof job> => Boolean(job)),
  );

  return c.json({ jobs, generatedAt: now });
});
