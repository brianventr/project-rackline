import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { rollupLabor } from "../domain/labor";
import { isLaborVerb } from "../domain/labor";
import { closeClock, openClocksForUser } from "../domain/labor-clock";
import { newId } from "../lib/ids";
import { recordLaborEvent } from "../db/labor";

export const laborRoute = new Hono<AppEnv>();

laborRoute.get("/labor", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  const now = Date.now();
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

  const openRows = await db
    .select()
    .from(schema.laborClocks)
    .where(and(eq(schema.laborClocks.organizationId, organizationId), isNull(schema.laborClocks.endedAt)))
    .orderBy(desc(schema.laborClocks.startedAt))
    .limit(100);

  const openClocks = openRows.map((row) => ({
    ...row,
    elapsedSec: openClocksForUser([row], now)[0]?.elapsedSec ?? 0,
  }));

  return c.json({
    events: rows,
    rollup: rollupLabor(rows),
    openClocks,
  });
});

laborRoute.post("/labor/clock-in", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    verb?: string;
    refType?: string;
    refId?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const verb = requireString(body.verb, "verb");
  if (!isLaborVerb(verb)) badRequest("Unknown labor verb");
  const refType = requireString(body.refType, "refType");
  const refId = requireString(body.refId, "refId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const now = Date.now();
  const [open] = await db
    .select()
    .from(schema.laborClocks)
    .where(
      and(
        eq(schema.laborClocks.organizationId, organizationId),
        eq(schema.laborClocks.userId, user.id),
        isNull(schema.laborClocks.endedAt),
      ),
    )
    .limit(1);
  if (open) conflict("Clock already open");
  const id = newId();
  await db.insert(schema.laborClocks).values({
    id,
    organizationId,
    warehouseId,
    userId: user.id,
    verb,
    refType,
    refId,
    startedAt: now,
    endedAt: null,
    durationSec: null,
  });
  const [clock] = await db.select().from(schema.laborClocks).where(eq(schema.laborClocks.id, id)).limit(1);
  return c.json(clock, 201);
});

laborRoute.post("/labor/clock-out", async (c) => {
  const body = await c.req.json<{ clockId?: string }>();
  const clockId = requireString(body.clockId, "clockId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const [clock] = await db
    .select()
    .from(schema.laborClocks)
    .where(and(eq(schema.laborClocks.id, clockId), eq(schema.laborClocks.organizationId, organizationId)))
    .limit(1);
  if (!clock) notFound("Clock not found");
  if (clock.userId !== user.id) conflict("Clock belongs to another user");
  if (clock.endedAt != null) conflict("Clock already closed");
  const now = Date.now();
  const closed = closeClock({ startedAt: clock.startedAt, endedAt: now });
  await db
    .update(schema.laborClocks)
    .set({ endedAt: closed.endedAt, durationSec: closed.durationSec })
    .where(eq(schema.laborClocks.id, clock.id));
  await recordLaborEvent(db, {
    organizationId,
    warehouseId: clock.warehouseId,
    userId: user.id,
    verb: clock.verb as import("../domain/labor").LaborVerbName,
    refType: clock.refType,
    refId: clock.refId,
    durationSec: closed.durationSec,
    now,
  });
  const [row] = await db.select().from(schema.laborClocks).where(eq(schema.laborClocks.id, clock.id)).limit(1);
  return c.json(row);
});
