import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { rollupLabor } from "../domain/labor";

export const laborRoute = new Hono<AppEnv>();

laborRoute.get("/labor", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  const rows = await db
    .select({
      id: schema.laborEvents.id,
      warehouseId: schema.laborEvents.warehouseId,
      userId: schema.laborEvents.userId,
      userName: schema.user.name,
      verb: schema.laborEvents.verb,
      refType: schema.laborEvents.refType,
      refId: schema.laborEvents.refId,
      qty: schema.laborEvents.qty,
      durationSec: schema.laborEvents.durationSec,
      notes: schema.laborEvents.notes,
      createdAt: schema.laborEvents.createdAt,
    })
    .from(schema.laborEvents)
    .innerJoin(schema.user, eq(schema.user.id, schema.laborEvents.userId))
    .where(
      and(
        eq(schema.laborEvents.organizationId, organizationId),
        warehouseId ? eq(schema.laborEvents.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.laborEvents.createdAt))
    .limit(200);

  return c.json({
    events: rows,
    rollup: rollupLabor(rows),
  });
});
