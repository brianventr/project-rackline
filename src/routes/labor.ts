import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest, forbidden, notFound } from "../lib/http";
import { loadLaborKpiInput } from "../db/labor";
import {
  LABOR_KPI_MAX_RANGE_MS,
  buildLaborKpis,
  laborRangeMs,
  laborSkuDetail,
  laborStaffDetail,
} from "../domain/labor-kpis";
import { getOrgItem } from "../lib/org";

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
  return c.json({
    range: window,
    ...board,
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
    itemId,
    userId: role === "owner" ? undefined : user.id,
  });
  const board = buildLaborKpis(input);
  return c.json({
    range: window,
    ...laborSkuDetail(board, itemId),
  });
});
