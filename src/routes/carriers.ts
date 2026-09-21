import { Hono } from "hono";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, optionalString, requireString, unauthorized } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import {
  defaultEnabledServices,
  demoCarrierSeeds,
  enabledServicesFromConnections,
  isCarrierProvider,
  parseEnabledServices,
  publicCarrierCatalog,
  resolveProvider,
  serializeCarrierConnection,
  testConnectionResult,
  validateConnectionCredentials,
  type CarrierConnectionLike,
  type CarrierCredentials,
} from "../domain/carriers";
import { asCarrierLiveError, pingAggregator } from "../lib/carrier-client";
import { pingDirect } from "../lib/direct-carrier";
import { isLiveAggregator, isLiveDirect } from "../domain/carrier-live";
import { isDirectProvider } from "../domain/direct-carrier";
import { normalizeTrackerStatus, parseTrackerWebhook, verifyTrackerHmac } from "../domain/tracker";
import { loadPackagesForOrders, orderPatchFromPackages } from "../db/packages";

export const carriersRoute = new Hono<AppEnv>();

export async function loadCarrierConnections(db: AppEnv["Variables"]["db"], organizationId: string) {
  return db
    .select()
    .from(schema.carrierConnections)
    .where(eq(schema.carrierConnections.organizationId, organizationId));
}

export async function recordCarrierEvent(
  db: AppEnv["Variables"]["db"],
  input: {
    organizationId: string;
    connectionId?: string | null;
    orderId?: string | null;
    kind: "test" | "rates" | "buy" | "void" | "tracker";
    status: string;
    request: unknown;
    response?: unknown;
    now?: number;
  },
) {
  await db.insert(schema.carrierOutboundEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    connectionId: input.connectionId ?? null,
    orderId: input.orderId ?? null,
    kind: input.kind,
    status: input.status,
    requestJson: JSON.stringify(input.request),
    responseJson: input.response === undefined ? null : JSON.stringify(input.response),
    createdAt: input.now ?? Date.now(),
  });
}

async function warehouseForOrg(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  warehouseId?: string | null,
) {
  if (warehouseId) {
    const [row] = await db
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1);
    if (row) return row;
  }
  const [row] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

function asLike(row: typeof schema.carrierConnections.$inferSelect): CarrierConnectionLike {
  return row;
}

function credentialsFrom(body: {
  accountNumber?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  meterNumber?: string | null;
}): CarrierCredentials {
  return {
    accountNumber: optionalString(body.accountNumber ?? undefined) ?? null,
    apiKey: optionalString(body.apiKey ?? undefined) ?? null,
    apiSecret: optionalString(body.apiSecret ?? undefined) ?? null,
    meterNumber: optionalString(body.meterNumber ?? undefined) ?? null,
  };
}

function keepOrReplace(next: string | null | undefined, current: string | null | undefined): string | null {
  if (next === undefined) return current ?? null;
  return next?.trim() ? next.trim() : null;
}

async function clearDefault(db: AppEnv["Variables"]["db"], organizationId: string) {
  await db
    .update(schema.carrierConnections)
    .set({ isDefault: false })
    .where(eq(schema.carrierConnections.organizationId, organizationId));
}

carriersRoute.get("/carriers", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouse = await warehouseForOrg(db, organizationId, c.req.query("warehouseId"));
  const connections = await loadCarrierConnections(db, organizationId);
  return c.json({
    catalog: publicCarrierCatalog(),
    connections: connections.map((row) => serializeCarrierConnection(asLike(row))),
    enabledServices: enabledServicesFromConnections(connections.map(asLike)),
    shipFromAddress: warehouse?.shipFromAddress ?? null,
    warehouseId: warehouse?.id ?? null,
    trackerWebhookUrl: `${c.get("origin")}/api/carriers/trackers/webhooks`,
  });
});

carriersRoute.get("/carriers/outbound", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(schema.carrierOutboundEvents)
    .where(eq(schema.carrierOutboundEvents.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.carrierOutboundEvents.createdAt))
    .limit(25);
  return c.json(
    rows.map((row) => ({
      ...row,
      request: JSON.parse(row.requestJson) as unknown,
      response: row.responseJson ? (JSON.parse(row.responseJson) as unknown) : null,
    })),
  );
});

carriersRoute.post("/carriers/enable-demo", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const now = Date.now();
  const existing = await loadCarrierConnections(db, organizationId);
  const have = new Set(existing.map((row) => row.provider));
  for (const seed of demoCarrierSeeds()) {
    if (have.has(seed.provider)) continue;
    const id = newId();
    await db.insert(schema.carrierConnections).values({
      id,
      organizationId,
      provider: seed.provider,
      nickname: seed.nickname,
      accountNumber: seed.accountNumber,
      mode: "demo",
      status: "connected",
      enabledServicesJson: JSON.stringify(seed.enabledServices),
      isDefault: seed.isDefault && !existing.some((row) => row.isDefault),
      createdAt: now,
      updatedAt: now,
    });
  }
  const warehouse = await warehouseForOrg(db, organizationId, null);
  if (warehouse && !warehouse.shipFromAddress) {
    await db
      .update(schema.warehouses)
      .set({ shipFromAddress: "14 Dock St, Portland, OR 97209" })
      .where(eq(schema.warehouses.id, warehouse.id));
  }
  const connections = await loadCarrierConnections(db, organizationId);
  const nextWarehouse = await warehouseForOrg(db, organizationId, warehouse?.id);
  return c.json(
    {
      catalog: publicCarrierCatalog(),
      connections: connections.map((row) => serializeCarrierConnection(asLike(row))),
      enabledServices: enabledServicesFromConnections(connections.map(asLike)),
      shipFromAddress: nextWarehouse?.shipFromAddress ?? null,
      warehouseId: nextWarehouse?.id ?? null,
      trackerWebhookUrl: `${c.get("origin")}/api/carriers/trackers/webhooks`,
    },
    existing.length === connections.length ? 200 : 201,
  );
});

carriersRoute.post("/carriers", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    provider?: string;
    nickname?: string;
    accountNumber?: string | null;
    apiKey?: string | null;
    apiSecret?: string | null;
    meterNumber?: string | null;
    webhookSecret?: string | null;
    mode?: string;
    enabledServices?: string[];
    isDefault?: boolean;
  }>();
  const providerId = requireString(body.provider, "provider").toLowerCase();
  if (!isCarrierProvider(providerId)) badRequest("Unknown carrier provider");
  const provider = resolveProvider(providerId)!;
  const mode = body.mode === "live" ? "live" : "demo";
  const creds = credentialsFrom(body);
  const valid = validateConnectionCredentials(providerId, { ...creds, mode });
  if (!valid.ok) badRequest(valid.error);
  const enabledServices = Array.isArray(body.enabledServices)
    ? parseEnabledServices(JSON.stringify(body.enabledServices), providerId)
    : defaultEnabledServices(providerId);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await loadCarrierConnections(db, organizationId);
  if (existing.some((row) => row.provider === providerId)) {
    conflict(`${provider.name} is already connected`);
  }
  const now = Date.now();
  const isDefault = body.isDefault === true || existing.every((row) => !row.isDefault);
  if (isDefault) await clearDefault(db, organizationId);
  const id = newId();
  await db.insert(schema.carrierConnections).values({
    id,
    organizationId,
    provider: providerId,
    nickname: optionalString(body.nickname) || provider.name,
    accountNumber: creds.accountNumber,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    meterNumber: creds.meterNumber,
    webhookSecret: optionalString(body.webhookSecret) ?? null,
    mode,
    status: "connected",
    enabledServicesJson: JSON.stringify(enabledServices),
    isDefault,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, id)).limit(1);
  return c.json(serializeCarrierConnection(asLike(row!)), 201);
});

carriersRoute.patch("/carriers/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    nickname?: string;
    accountNumber?: string | null;
    apiKey?: string | null;
    apiSecret?: string | null;
    meterNumber?: string | null;
    webhookSecret?: string | null;
    mode?: string;
    enabledServices?: string[];
    isDefault?: boolean;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [existing] = await db
    .select()
    .from(schema.carrierConnections)
    .where(
      and(eq(schema.carrierConnections.id, c.req.param("id")), eq(schema.carrierConnections.organizationId, organizationId)),
    )
    .limit(1);
  if (!existing) notFound("Carrier account not found");
  const mode = body.mode === undefined ? existing.mode : body.mode === "live" ? "live" : "demo";
  const creds: CarrierCredentials = {
    accountNumber:
      body.accountNumber === undefined ? existing.accountNumber : keepOrReplace(body.accountNumber, existing.accountNumber),
    apiKey: body.apiKey === undefined ? existing.apiKey : keepOrReplace(body.apiKey, existing.apiKey),
    apiSecret: body.apiSecret === undefined ? existing.apiSecret : keepOrReplace(body.apiSecret, existing.apiSecret),
    meterNumber:
      body.meterNumber === undefined ? existing.meterNumber : keepOrReplace(body.meterNumber, existing.meterNumber),
  };
  const valid = validateConnectionCredentials(existing.provider, { ...creds, mode });
  if (!valid.ok) badRequest(valid.error);
  const enabledServices = Array.isArray(body.enabledServices)
    ? parseEnabledServices(JSON.stringify(body.enabledServices), existing.provider)
    : parseEnabledServices(existing.enabledServicesJson, existing.provider);
  const now = Date.now();
  if (body.isDefault === true) await clearDefault(db, organizationId);
  const [row] = await db
    .update(schema.carrierConnections)
    .set({
      nickname: optionalString(body.nickname) || existing.nickname,
      accountNumber: creds.accountNumber,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      meterNumber: creds.meterNumber,
      webhookSecret:
        body.webhookSecret === undefined ? existing.webhookSecret : keepOrReplace(body.webhookSecret, existing.webhookSecret),
      mode,
      status: existing.status,
      enabledServicesJson: JSON.stringify(enabledServices),
      isDefault: body.isDefault === true ? true : existing.isDefault,
      updatedAt: now,
    })
    .where(eq(schema.carrierConnections.id, existing.id))
    .returning();
  return c.json(serializeCarrierConnection(asLike(row)));
});

carriersRoute.post("/carriers/:id/test", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [existing] = await db
    .select()
    .from(schema.carrierConnections)
    .where(
      and(eq(schema.carrierConnections.id, c.req.param("id")), eq(schema.carrierConnections.organizationId, organizationId)),
    )
    .limit(1);
  if (!existing) notFound("Carrier account not found");
  const now = Date.now();
  let result: { ok: true; message: string } | { ok: false; error: string } = testConnectionResult({
    provider: existing.provider,
    mode: existing.mode,
    credentials: {
      accountNumber: existing.accountNumber,
      apiKey: existing.apiKey,
      apiSecret: existing.apiSecret,
      meterNumber: existing.meterNumber,
    },
  });
  if (result.ok && isLiveAggregator(existing.provider, existing.mode) && existing.apiKey) {
    try {
      result = await pingAggregator(existing.provider as "easypost" | "shipengine", existing.apiKey);
    } catch (err) {
      result = { ok: false, error: asCarrierLiveError(err).message };
    }
  } else if (
    result.ok &&
    isLiveDirect(existing.provider, existing.mode) &&
    existing.apiKey &&
    isDirectProvider(existing.provider)
  ) {
    try {
      result = await pingDirect({
        provider: existing.provider,
        accountNumber: existing.accountNumber || "",
        apiKey: existing.apiKey,
        apiSecret: existing.apiSecret,
        meterNumber: existing.meterNumber,
      });
    } catch (err) {
      result = { ok: false, error: asCarrierLiveError(err).message };
    }
  }
  const ok = result.ok;
  await db
    .update(schema.carrierConnections)
    .set({
      status: ok ? "connected" : "error",
      lastTestedAt: now,
      lastTestStatus: ok ? "ok" : "failed",
      lastTestError: ok ? null : result.error,
      updatedAt: now,
    })
    .where(eq(schema.carrierConnections.id, existing.id));
  const request = {
    provider: existing.provider,
    mode: existing.mode,
    accountNumber: existing.accountNumber,
    action: "test",
  };
  const response = ok ? { ok: true, message: result.message } : { ok: false, error: result.error };
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: existing.id,
    kind: "test",
    status: ok ? "ok" : "failed",
    request,
    response,
    now,
  });
  const [row] = await db.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, existing.id)).limit(1);
  if (!ok) badRequest(result.error);
  return c.json({ connection: serializeCarrierConnection(asLike(row!)), ...response });
});

carriersRoute.delete("/carriers/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [existing] = await db
    .select()
    .from(schema.carrierConnections)
    .where(
      and(eq(schema.carrierConnections.id, c.req.param("id")), eq(schema.carrierConnections.organizationId, organizationId)),
    )
    .limit(1);
  if (!existing) notFound("Carrier account not found");
  if (existing.provider === "rackline") {
    conflict("Cannot disconnect Rackline Ground");
  }
  const wasDefault = existing.isDefault;
  await db.delete(schema.carrierConnections).where(eq(schema.carrierConnections.id, existing.id));
  if (wasDefault) {
    const remaining = await loadCarrierConnections(db, organizationId);
    const fallback = remaining.find((row) => row.provider === "rackline") ?? remaining[0];
    if (fallback) {
      await db
        .update(schema.carrierConnections)
        .set({ isDefault: true, updatedAt: Date.now() })
        .where(eq(schema.carrierConnections.id, fallback.id));
    }
  }
  return c.json({ disconnected: true });
});

export const carriersPublicRoute = new Hono<AppEnv>();

carriersPublicRoute.post("/carriers/trackers/webhooks", async (c) => {
  const db = c.get("db");
  const raw = await c.req.text();
  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      badRequest("Invalid JSON");
    }
  }
  const parsed = parseTrackerWebhook(payload);
  if (!parsed) badRequest("Tracker payload needs a tracking number and status");
  const hmac =
    c.req.header("X-Hmac-Signature") ||
    c.req.header("x-hmac-signature") ||
    c.req.header("X-ShipEngine-Hmac-SHA256") ||
    c.req.header("x-shipengine-hmac-sha256") ||
    c.req.header("X-Tracker-Hmac") ||
    c.req.header("x-tracker-hmac");

  const packageHits = await db
    .select()
    .from(schema.orderPackages)
    .where(eq(schema.orderPackages.trackingNumber, parsed.trackingNumber));
  const orderHits = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.trackingNumber, parsed.trackingNumber));
  if (packageHits.length === 0 && orderHits.length === 0) {
    return c.json({ ignored: true, reason: "unknown_tracking" });
  }

  const orgIds = [...new Set([...packageHits.map((row) => row.organizationId), ...orderHits.map((row) => row.organizationId)])];
  const connections = await db
    .select()
    .from(schema.carrierConnections)
    .where(
      and(
        inArray(schema.carrierConnections.organizationId, orgIds),
        or(eq(schema.carrierConnections.provider, "easypost"), eq(schema.carrierConnections.provider, "shipengine")),
      ),
    );
  const liveSecrets = connections.filter(
    (row) => isLiveAggregator(row.provider, row.mode) && Boolean(row.webhookSecret),
  );
  if (liveSecrets.length > 0) {
    let ok = false;
    for (const row of liveSecrets) {
      if (await verifyTrackerHmac(row.webhookSecret!, raw, hmac)) {
        ok = true;
        break;
      }
    }
    if (!ok) unauthorized("Invalid tracker HMAC");
  }

  const now = Date.now();
  const status = normalizeTrackerStatus(parsed.status) ?? parsed.status.toLowerCase();
  const updatedOrders = new Set<string>();
  const results: { orderId: string; packageId: string | null; trackerStatus: string }[] = [];

  for (const orgId of orgIds) {
    const eventId = parsed.eventId;
    if (eventId) {
      const [existing] = await db
        .select({ id: schema.trackerWebhookReceipts.id })
        .from(schema.trackerWebhookReceipts)
        .where(
          and(eq(schema.trackerWebhookReceipts.organizationId, orgId), eq(schema.trackerWebhookReceipts.eventId, eventId)),
        )
        .limit(1);
      if (existing) {
        return c.json({ ok: true, duplicate: true });
      }
    }
    await db.insert(schema.trackerWebhookReceipts).values({
      id: newId(),
      organizationId: orgId,
      provider: parsed.provider,
      trackingNumber: parsed.trackingNumber,
      eventId: eventId,
      payloadJson: JSON.stringify(payload),
      createdAt: now,
    });
  }

  for (const pkg of packageHits) {
    await db
      .update(schema.orderPackages)
      .set({ trackerStatus: status, trackerUpdatedAt: now })
      .where(eq(schema.orderPackages.id, pkg.id));
    updatedOrders.add(pkg.orderId);
    results.push({ orderId: pkg.orderId, packageId: pkg.id, trackerStatus: status });
  }
  for (const order of orderHits) {
    const packages = (await loadPackagesForOrders(db, [order.id])).get(order.id) ?? [];
    if (packages.length === 0) {
      await db
        .update(schema.orders)
        .set({ trackerStatus: status, trackerUpdatedAt: now })
        .where(eq(schema.orders.id, order.id));
      results.push({ orderId: order.id, packageId: null, trackerStatus: status });
    } else {
      updatedOrders.add(order.id);
    }
  }
  for (const orderId of updatedOrders) {
    const packages = (await loadPackagesForOrders(db, [orderId])).get(orderId) ?? [];
    const patch = orderPatchFromPackages(packages);
    if (patch) {
      await db
        .update(schema.orders)
        .set({ trackerStatus: patch.trackerStatus, trackerUpdatedAt: now })
        .where(eq(schema.orders.id, orderId));
    }
  }

  const connectionId = connections[0]?.id ?? null;
  for (const orgId of orgIds) {
    await recordCarrierEvent(db, {
      organizationId: orgId,
      connectionId,
      orderId: results[0]?.orderId ?? null,
      kind: "tracker",
      status: "ok",
      request: { trackingNumber: parsed.trackingNumber, provider: parsed.provider, eventId: parsed.eventId },
      response: { trackerStatus: status, matches: results },
      now,
    });
  }

  return c.json({ ok: true, trackerStatus: status, matches: results });
});

