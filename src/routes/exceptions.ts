import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { findException, forgetClaim, loadClaims, loadInbox, saveClaim } from "../db/exceptions/inbox";
import { exceptionSource } from "../db/exceptions/registry";
import type { ExceptionSourceContext } from "../db/exceptions/source";
import { serializeAuditPayload } from "../domain/audit";
import {
  currentClaim,
  decideClaim,
  EXCEPTION_AUDIT_ACTIONS,
  exceptionAuditSummary,
  exceptionView,
  MAX_SNOOZE_HOURS,
  resolutionNote,
  snoozeUntil,
  type ClaimRequest,
  type ExceptionClaim,
  type ExceptionItem,
  type ExceptionVerb,
} from "../domain/exceptions/inbox";
import { isGarageMode } from "../domain/operating-mode";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { newId } from "../lib/ids";
import { internalApi } from "../lib/internal-api";
import { requireOwner } from "../lib/org";
import type { AppEnv } from "../lib/types";
import { channelsRoute } from "./channels";
import { holdsRoute } from "./holds";
import { ordersRoute } from "./orders";
import { shipRoute } from "./ship";
import { shopifyRoute } from "./shopify";

export const exceptionsRoute = new Hono<AppEnv>();

type ExceptionBody = { warehouseId?: unknown; takeOver?: unknown; hours?: unknown; note?: unknown; actionId?: unknown };

const VERBS = new Set<string>(["claim", "unclaim", "snooze", "resolve", "reopen", "action"]);

/** Where inline actions run, mounted in the same order as the app so the same handler answers. */
const ACTION_ROUTES = [shipRoute, ordersRoute, shopifyRoute, holdsRoute, channelsRoute];

async function sourceContext(c: Context<AppEnv>, warehouseId: unknown): Promise<ExceptionSourceContext> {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = requireString(warehouseId, "warehouseId");
  const [building] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.warehouses)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.warehouses.organizationId))
    .where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!building) notFound("Warehouse not found");
  return { db, organizationId, warehouseId: id, mode: isGarageMode(building.operatingMode) ? "garage" : "warehouse", now: Date.now() };
}

function claimRequest(verb: ExceptionVerb, body: ExceptionBody, now: number): ClaimRequest {
  switch (verb) {
    case "claim":
      return { verb, takeOver: body.takeOver === true };
    case "snooze": {
      const until = snoozeUntil(body.hours, now);
      if (until == null) badRequest(`Snooze for a whole number of hours, up to ${MAX_SNOOZE_HOURS}`);
      return { verb, until };
    }
    case "resolve": {
      const note = resolutionNote(body.note);
      if (!note) badRequest("Say what you did, so the next person knows");
      return { verb, note };
    }
    default:
      return { verb };
  }
}

async function auditException(
  c: Context<AppEnv>,
  input: { verb: ExceptionVerb; item: ExceptionItem; path: string; status: number; summary: string; extra?: Record<string, unknown> },
): Promise<void> {
  const user = c.get("user")!;
  const { item } = input;
  try {
    await c
      .get("db")
      .insert(schema.auditEvents)
      .values({
        id: newId(),
        organizationId: c.get("organizationId")!,
        actorUserId: user.id,
        actorEmail: user.email,
        actorName: user.name,
        action: EXCEPTION_AUDIT_ACTIONS[input.verb],
        method: "POST",
        path: input.path,
        status: input.status,
        code: null,
        summary: input.summary,
        payloadJson: serializeAuditPayload({
          source: item.source,
          key: item.key,
          kind: item.kind,
          title: item.title,
          warehouseId: item.warehouseId,
          orderId: item.orderId,
          itemId: item.itemId,
          locationId: item.locationId,
          ...input.extra,
        }),
        createdAt: Date.now(),
      });
  } catch (err) {
    console.error("exception audit write failed", err);
  }
}

exceptionsRoute.get("/exceptions", async (c) => {
  const ctx = await sourceContext(c, c.req.query("warehouseId"));
  return c.json(await loadInbox(ctx, { userId: c.get("user")!.id, role: c.get("role")! }));
});

exceptionsRoute.post("/exceptions/:source/:key/:verb", async (c) => {
  const verbParam = c.req.param("verb");
  if (!VERBS.has(verbParam)) notFound("Unknown exception verb");
  const verb = verbParam as ExceptionVerb;
  const body = await c.req.json<ExceptionBody>().catch(() => ({}) as ExceptionBody);
  const ctx = await sourceContext(c, body.warehouseId);
  const source = exceptionSource(c.req.param("source"));
  if (!source || !source.modes.includes(ctx.mode)) notFound("Unknown exception source");

  const item = await findException(ctx, source, c.req.param("key"));
  if (!item) conflict("This problem has already cleared.", "EXCEPTION_CLEARED");
  const role = c.get("role")!;
  if (item.ownerOnly) requireOwner(role);
  const user = c.get("user")!;
  const request = claimRequest(verb, body, ctx.now);
  const [stored = null] = await loadClaims(ctx.db, ctx.organizationId, [item]);
  const claim = currentClaim(item, stored);
  const decision = decideClaim(claim, request, { userId: user.id, role, now: ctx.now });
  if (!decision.ok) conflict(decision.error, decision.code);

  if (request.verb === "action") {
    const action = item.action && item.action.id === body.actionId ? item.action : null;
    const call = action ? source.action?.(item, action.id) : null;
    if (!action || !call) badRequest("That action is not offered for this problem");
    const result = await internalApi(c, ACTION_ROUTES)<Record<string, unknown>>("POST", call.path, call.body);
    const failure = call.failure ? call.failure(result) : result.ok ? null : result.error;
    if (failure) {
      const code = (!result.ok && result.code) || "EXCEPTION_ACTION_FAILED";
      return c.json({ error: failure, code }, (result.ok ? 409 : result.status) as ContentfulStatusCode);
    }
    await auditException(c, {
      verb,
      item,
      path: `/api${call.path}`,
      status: result.status,
      summary: exceptionAuditSummary(verb, item, { actionLabel: action.label }),
      extra: { actionId: action.id },
    });
    const after = await findException({ ...ctx, now: Date.now() }, source, item.key);
    if (!after) {
      await forgetClaim(ctx.db, ctx.organizationId, item);
      return c.json({ cleared: true, item: null });
    }
    const [latest = null] = await loadClaims(ctx.db, ctx.organizationId, [after]);
    return c.json({ cleared: false, item: exceptionView(after, latest, Date.now()) });
  }

  const saved = await saveClaim(ctx.db, { organizationId: ctx.organizationId, item, stored, patch: decision.patch, now: ctx.now });
  if (!saved) conflict("Someone else just changed this. Refresh to see what they did.", "EXCEPTION_CHANGED");
  const takeOver = request.verb === "claim" && Boolean(claim?.claimedBy && claim.claimedBy !== user.id);
  const hours = request.verb === "snooze" ? Number(body.hours) : undefined;
  const note = request.verb === "resolve" ? request.note : undefined;
  await auditException(c, {
    verb,
    item,
    path: new URL(c.req.url).pathname,
    status: 200,
    summary: exceptionAuditSummary(verb, item, { takeOver, hours, note }),
    extra: { takeOver: takeOver || undefined, hours, note },
  });
  const next: ExceptionClaim = {
    source: item.source,
    key: item.key,
    ...decision.patch,
    claimedByName: decision.patch.claimedBy === user.id ? user.name : (claim?.claimedByName ?? null),
    resolvedByName: decision.patch.resolvedBy === user.id ? user.name : (claim?.resolvedByName ?? null),
  };
  return c.json({ cleared: false, item: exceptionView(item, next, ctx.now) });
});
