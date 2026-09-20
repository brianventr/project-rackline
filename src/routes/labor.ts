import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, forbidden, notFound, requireString } from "../lib/http";
import { loadLaborKpiInput, recordLaborEvent } from "../db/labor";
import {
  LABOR_KPI_MAX_RANGE_MS,
  buildLaborKpis,
  laborRangeMs,
  laborSkuDetail,
  laborStaffDetail,
} from "../domain/labor-kpis";
import { getOrgItem } from "../lib/org";
import { rollupLabor } from "../domain/labor";
import { isLaborVerb } from "../domain/labor";
import { closeClock, openClocksForUser } from "../domain/labor-clock";
import { newId } from "../lib/ids";

export const laborRoute = new Hono<AppEnv>();

function parseWindow(c: { req: { query: (name: string) => string | undefined } }, now: number) {
  const presetRaw = c.req.query("preset");
  const fromRaw = c.req.query("from");
  const toRaw = c.req.query("to");
  if (fromRaw || toRaw) {
    const to = toRaw ? Number(toRaw) : now;
    const from = fromRaw ? Number(fromRaw) : to - 7 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to)) badRequest("from and to must be epoch milliseconds");
    if (from > to) badRequest("from must be before to");
    if (to - from > LABOR_KPI_MAX_RANGE_MS) badRequest("Range cannot exceed 30 days");
    return { from, to, preset: "custom" as const };
  }
  const preset = presetRaw === "today" || presetRaw === "30d" ? presetRaw : "7d";
  return { ...laborRangeMs(now, preset), preset };
}

function scopedUserId(role: string | undefined, userId: string, requested?: string) {
  if (role === "owner") return requested;
  if (requested && requested !== userId) forbidden("Operators can only view their own performance");
  return userId;
}

laborRoute.get("/labor", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const role = c.get("role");
  const user = c.get("user")!;
  const warehouseId = c.req.query("warehouseId") || undefined;
  const now = Date.now();
  const window = parseWindow(c, now);
  const userId = scopedUserId(role, user.id);
  const input = await loadLaborKpiInput(db, {
    organizationId,
    warehouseId,
    from: window.from,
    to: window.to,
    userId: role === "owner" ? undefined : userId,
  });
  const board = buildLaborKpis(input);

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
    range: window,
    ...board,
    events: rows,
    rollup: rollupLabor(rows),
    openClocks,
  });
});

laborRoute.get("/labor/staff/:userId", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const role = c.get("role");
  const sessionUser = c.get("user")!;
  const requested = c.req.param("userId");
  const userId = scopedUserId(role, sessionUser.id, requested) ?? requested;
  const warehouseId = c.req.query("warehouseId") || undefined;
  const now = Date.now();
  const window = parseWindow(c, now);
  const member = (await loadLaborKpiInput(db, { organizationId, from: window.from, to: window.to })).members.find(
    (row) => row.userId === userId,
  );
  if (!member) notFound("Teammate not found");
  const input = await loadLaborKpiInput(db, {
    organizationId,
    warehouseId,
    from: window.from,
    to: window.to,
    userId,
  });
  const board = buildLaborKpis(input);
  const detail = laborStaffDetail(board, input.facts, userId);
  return c.json({
    range: window,
    ...detail,
    staff: detail.staff ?? {
      userId: member.userId,
      userName: member.userName,
      role: member.role,
      lines: 0,
      units: 0,
      exceptionUnits: 0,
      exceptionRate: 0,
      activeMs: 0,
      activeHours: 0,
      lph: 0,
      uph: 0,
      expectedMs: 0,
      pace: 5,
      topSkus: [],
    },
  });
});

laborRoute.get("/labor/skus/:itemId", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const role = c.get("role");
  const user = c.get("user")!;
  const itemId = c.req.param("itemId");
  await getOrgItem(db, organizationId, itemId);
  const warehouseId = c.req.query("warehouseId") || undefined;
  const now = Date.now();
  const window = parseWindow(c, now);
  const input = await loadLaborKpiInput(db, {
    organizationId,
    warehouseId,
    from: window.from,
    to: window.to,
    userId: role === "owner" ? undefined : user.id,
  });
  const board = buildLaborKpis(input);
  return c.json({
    range: window,
    ...laborSkuDetail(board, input.facts, itemId),
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
