import { Hono } from "hono";
import type { Context } from "hono";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { originFrom } from "../lib/types";
import { badRequest, conflict, requireString, unauthorized } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import {
  REQUIRED_SCOPES,
  SHOPIFY_API_VERSION,
  buildDemoOrderPayload,
  maskSecret,
  normalizeShopDomain,
  shopifyHmac,
  verifyShopifyHmac,
  type ShopifyRestOrder,
} from "../domain/shopify";
import {
  ShopifyIngestError,
  cancelShopifyDraft,
  ingestFulfillmentOrderNode,
  ingestRestOrder,
  recordWebhookReceipt,
  type ShopifyConnectionRow,
} from "../domain/shopify-ingest";
import {
  acceptFulfillmentRequest,
  createShopifyGraphqlClient,
  fetchAssignedFulfillmentOrders,
} from "../lib/shopify-client";
import {
  listShopifyLocationsForOrg,
  loadSellableRows,
  syncShopifySellable,
} from "../db/shopify-sellable";
import { demoShopifyLocationGid } from "../domain/shopify-sellable";
import {
  assertOauthShop,
  shopifyAuthorizeUrl,
  signOAuthState,
  verifyOAuthState,
  verifyShopifyOAuthHmac,
} from "../domain/shopify-oauth";

export const shopifyPublicRoute = new Hono<AppEnv>();
export const shopifyRoute = new Hono<AppEnv>();

async function connectionByShop(db: AppEnv["Variables"]["db"], shopDomain: string) {
  const domain = normalizeShopDomain(shopDomain);
  const [row] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.shopDomain, domain))
    .limit(1);
  return row ?? null;
}

async function connectionByOrg(db: AppEnv["Variables"]["db"], organizationId: string) {
  const [row] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

function publicUrls(origin: string) {
  return {
    webhookUrl: `${origin}/api/shopify/webhooks`,
    fulfillmentNotificationUrl: `${origin}/api/shopify/fulfillment_order_notification`,
  };
}

function serializeConnection(row: ShopifyConnectionRow | null, origin: string) {
  const urls = publicUrls(origin);
  if (!row) {
    return {
      connected: false,
      shopDomain: null,
      mode: "demo",
      apiVersion: SHOPIFY_API_VERSION,
      hasAccessToken: false,
      hasWebhookSecret: false,
      tokenHint: null,
      shopifyLocationGid: null,
      scopes: REQUIRED_SCOPES,
      ...urls,
    };
  }
  return {
    connected: true,
    shopDomain: row.shopDomain,
    mode: row.mode,
    apiVersion: row.apiVersion,
    hasAccessToken: Boolean(row.accessToken),
    hasWebhookSecret: Boolean(row.webhookSecret),
    tokenHint: maskSecret(row.accessToken),
    shopifyLocationGid: row.shopifyLocationGid,
    scopes: REQUIRED_SCOPES,
    ...urls,
  };
}

async function handleSignedBody(c: Context<AppEnv>, pathKind: "webhook" | "notification") {
  const raw = await c.req.text();
  const shopHeader = c.req.header("X-Shopify-Shop-Domain") || c.req.header("x-shopify-shop-domain");
  if (!shopHeader) unauthorized("Missing X-Shopify-Shop-Domain");
  const connection = await connectionByShop(c.get("db"), shopHeader);
  if (!connection) {
    return c.json({ ignored: true, reason: "unknown_shop" }, 404);
  }
  const hmac =
    c.req.header("X-Shopify-Hmac-Sha256") ||
    c.req.header("X-Shopify-Hmac-SHA256") ||
    c.req.header("x-shopify-hmac-sha256");
  if (!(await verifyShopifyHmac(connection.webhookSecret, raw, hmac))) {
    unauthorized("Invalid Shopify HMAC");
  }

  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      badRequest("Invalid JSON");
    }
  }

  const topic = (c.req.header("X-Shopify-Topic") || c.req.header("x-shopify-topic") || pathKind).toLowerCase();
  const webhookId = c.req.header("X-Shopify-Webhook-Id") || c.req.header("x-shopify-webhook-id") || newId();
  const fresh = await recordWebhookReceipt(c.get("db"), {
    id: webhookId,
    organizationId: connection.organizationId,
    topic,
    shopDomain: connection.shopDomain,
  });
  if (!fresh) {
    return c.json({ ok: true, duplicate: true });
  }

  if (pathKind === "notification") {
    const kind =
      payload && typeof payload === "object" && "kind" in payload
        ? String((payload as { kind?: string }).kind)
        : "";
    return handleFulfillmentNotification(c, connection, kind);
  }

  return handleWebhookTopic(c, connection, topic, payload);
}

async function handleWebhookTopic(
  c: Context<AppEnv>,
  connection: ShopifyConnectionRow,
  topic: string,
  payload: unknown,
) {
  if (topic === "orders/create" || topic === "orders/updated" || topic === "orders/paid") {
    const order = payload as ShopifyRestOrder;
    if (order.cancelled_at && order.id != null) {
      await cancelShopifyDraft(c.get("db"), connection.organizationId, String(order.id));
    }
    const result = await ingestRestOrder(c.get("db"), connection, order);
    return c.json({ ok: true, topic, ...result });
  }

  if (topic === "orders/cancelled" && payload && typeof payload === "object" && "id" in payload) {
    const cancelled = await cancelShopifyDraft(
      c.get("db"),
      connection.organizationId,
      String((payload as { id: string | number }).id),
    );
    return c.json({ ok: true, topic, cancelled });
  }

  if (topic.includes("fulfillment_request")) {
    return handleFulfillmentNotification(c, connection, "FULFILLMENT_REQUEST");
  }

  return c.json({ ok: true, ignored: true, topic });
}

async function handleFulfillmentNotification(
  c: Context<AppEnv>,
  connection: ShopifyConnectionRow,
  kind: string,
) {
  if (kind !== "FULFILLMENT_REQUEST") {
    return c.json({ ok: true, kind, ignored: kind !== "CANCELLATION_REQUEST" });
  }
  if (connection.mode !== "live" || !connection.accessToken) {
    return c.json({ ok: true, kind, mode: connection.mode, ingested: [] });
  }
  const client = createShopifyGraphqlClient({
    shopDomain: connection.shopDomain,
    accessToken: connection.accessToken,
    apiVersion: connection.apiVersion,
  });
  const assigned = await fetchAssignedFulfillmentOrders(client);
  const ingested = [];
  for (const node of assigned) {
    try {
      await acceptFulfillmentRequest(client, node.id);
    } catch {
      // Merchant-managed locations can skip accept and still ingest.
    }
    ingested.push(await ingestFulfillmentOrderNode(c.get("db"), connection, node));
  }
  return c.json({ ok: true, kind, ingested });
}

shopifyPublicRoute.post("/shopify/webhooks", (c) => handleSignedBody(c, "webhook"));
shopifyPublicRoute.post("/shopify/fulfillment_order_notification", (c) =>
  handleSignedBody(c, "notification"),
);

function installRedirect(origin: string, query: string): string {
  return `${origin}/setup/shopify?${query}`;
}

shopifyPublicRoute.get("/shopify/oauth/callback", async (c) => {
  const origin = originFrom(c.req.url);
  const params = new URL(c.req.url).searchParams;
  const apiKey = c.env.SHOPIFY_API_KEY?.trim();
  const apiSecret = c.env.SHOPIFY_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return c.redirect(installRedirect(origin, "error=missing_app"));
  if (!(await verifyShopifyOAuthHmac(params, apiSecret))) return c.redirect(installRedirect(origin, "error=hmac"));
  const code = params.get("code")?.trim();
  const shopParam = params.get("shop")?.trim();
  const stateToken = params.get("state")?.trim();
  if (!code || !shopParam || !stateToken) return c.redirect(installRedirect(origin, "error=state"));
  let state;
  try {
    state = await verifyOAuthState(c.env.BETTER_AUTH_SECRET, stateToken);
    if (assertOauthShop(shopParam) !== state.shop) return c.redirect(installRedirect(origin, "error=shop"));
  } catch {
    return c.redirect(installRedirect(origin, "error=state"));
  }
  const shop = state.shop;
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: unknown };
  const accessToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token.trim() : "";
  if (!tokenRes.ok || !accessToken) return c.redirect(installRedirect(origin, "error=token"));

  const db = c.get("db");
  const taken = await connectionByShop(db, shop);
  if (taken && taken.organizationId !== state.organizationId) {
    return c.redirect(installRedirect(origin, "error=shop"));
  }
  const existing = await connectionByOrg(db, state.organizationId);
  const now = Date.now();
  if (existing) {
    await db
      .update(schema.shopifyConnections)
      .set({
        shopDomain: shop,
        accessToken,
        webhookSecret: apiSecret,
        mode: "live",
        apiVersion: existing.apiVersion || SHOPIFY_API_VERSION,
        updatedAt: now,
      })
      .where(eq(schema.shopifyConnections.id, existing.id));
  } else {
    await db.insert(schema.shopifyConnections).values({
      id: newId(),
      organizationId: state.organizationId,
      shopDomain: shop,
      accessToken,
      webhookSecret: apiSecret,
      apiVersion: SHOPIFY_API_VERSION,
      shopifyLocationGid: null,
      mode: "live",
      createdAt: now,
      updatedAt: now,
    });
  }
  return c.redirect(installRedirect(origin, "installed=1"));
});

shopifyRoute.get("/shopify/oauth/start", async (c) => {
  requireOwner(c.get("role"));
  const apiKey = c.env.SHOPIFY_API_KEY?.trim();
  const apiSecret = c.env.SHOPIFY_API_SECRET?.trim();
  if (!apiKey || !apiSecret) conflict("Shopify app credentials are not configured", "MISSING_APP");
  let shop: string;
  try {
    shop = assertOauthShop(c.req.query("shop") || "");
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Shop domain is required");
  }
  const state = await signOAuthState(c.env.BETTER_AUTH_SECRET, {
    organizationId: c.get("organizationId")!,
    shop,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const url = shopifyAuthorizeUrl({
    shop,
    clientId: apiKey,
    redirectUri: `${originFrom(c.req.url)}/api/shopify/oauth/callback`,
    state,
    scopes: REQUIRED_SCOPES,
  });
  return c.json({ url });
});

shopifyRoute.get("/shopify/connection", async (c) => {
  const row = await connectionByOrg(c.get("db"), c.get("organizationId")!);
  return c.json(serializeConnection(row, originFrom(c.req.url)));
});

shopifyRoute.put("/shopify/connection", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    shopDomain?: string;
    accessToken?: string | null;
    webhookSecret?: string;
    apiVersion?: string;
    shopifyLocationGid?: string | null;
    mode?: string;
  }>();
  const shopDomain = normalizeShopDomain(requireString(body.shopDomain, "shopDomain"));
  const mode = body.mode === "live" ? "live" : "demo";
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await connectionByOrg(db, organizationId);
  if (mode === "live" && !body.accessToken?.trim() && !existing?.accessToken) {
    badRequest("Admin API access token is required for live mode");
  }
  const now = Date.now();
  const webhookSecret = body.webhookSecret?.trim() || existing?.webhookSecret;
  if (!webhookSecret) badRequest("webhookSecret is required");
  const accessToken =
    body.accessToken === undefined ? (existing?.accessToken ?? null) : body.accessToken?.trim() || null;

  if (existing) {
    await db
      .update(schema.shopifyConnections)
      .set({
        shopDomain,
        accessToken,
        webhookSecret,
        apiVersion: body.apiVersion?.trim() || existing.apiVersion || SHOPIFY_API_VERSION,
        shopifyLocationGid:
          body.shopifyLocationGid === undefined ? existing.shopifyLocationGid : body.shopifyLocationGid,
        mode,
        updatedAt: now,
      })
      .where(eq(schema.shopifyConnections.id, existing.id));
  } else {
    await db.insert(schema.shopifyConnections).values({
      id: newId(),
      organizationId,
      shopDomain,
      accessToken,
      webhookSecret,
      apiVersion: body.apiVersion?.trim() || SHOPIFY_API_VERSION,
      shopifyLocationGid: body.shopifyLocationGid ?? null,
      mode,
      createdAt: now,
      updatedAt: now,
    });
  }
  const row = await connectionByOrg(db, organizationId);
  return c.json(serializeConnection(row, originFrom(c.req.url)));
});

shopifyRoute.post("/shopify/enable-demo", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await connectionByOrg(db, organizationId);
  if (existing) {
    return c.json(serializeConnection(existing, originFrom(c.req.url)));
  }
  const now = Date.now();
  await db.insert(schema.shopifyConnections).values({
    id: newId(),
    organizationId,
    shopDomain: `demo-${organizationId.slice(0, 8)}.myshopify.com`,
    accessToken: null,
    webhookSecret: `rackline-demo-${organizationId.slice(0, 8)}`,
    apiVersion: SHOPIFY_API_VERSION,
    shopifyLocationGid: demoShopifyLocationGid(),
    mode: "demo",
    createdAt: now,
    updatedAt: now,
  });
  const row = await connectionByOrg(db, organizationId);
  return c.json(serializeConnection(row, originFrom(c.req.url)), 201);
});

shopifyRoute.post("/shopify/simulate-order", async (c) => {
  const body = await c.req.json<{
    customerName?: string;
    email?: string;
    lines?: Array<{ sku?: string; title?: string; qty?: number }>;
  }>();
  const customerName = requireString(body.customerName, "customerName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one line is required");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  let connection = await connectionByOrg(db, organizationId);
  if (!connection) {
    const now = Date.now();
    await db.insert(schema.shopifyConnections).values({
      id: newId(),
      organizationId,
      shopDomain: `demo-${organizationId.slice(0, 8)}.myshopify.com`,
      accessToken: null,
      webhookSecret: `rackline-demo-${organizationId.slice(0, 8)}`,
      apiVersion: SHOPIFY_API_VERSION,
      shopifyLocationGid: demoShopifyLocationGid(),
      mode: "demo",
      createdAt: now,
      updatedAt: now,
    });
    connection = await connectionByOrg(db, organizationId);
  }
  if (!connection) badRequest("Could not create Shopify connection");

  const payload = buildDemoOrderPayload({
    customerName,
    email: body.email,
    lines: body.lines.map((line) => ({
      sku: requireString(line.sku, "sku"),
      title: line.title,
      qty: Number(line.qty),
    })),
  });
  const raw = JSON.stringify(payload);
  const hmac = await shopifyHmac(connection.webhookSecret, raw);
  if (!(await verifyShopifyHmac(connection.webhookSecret, raw, hmac))) {
    unauthorized("Demo HMAC failed");
  }
  try {
    const result = await ingestRestOrder(db, connection, payload);
    return c.json({ ok: true, hmacVerified: true, payload, ...result }, 201);
  } catch (err) {
    if (err instanceof ShopifyIngestError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    throw err;
  }
});

shopifyRoute.get("/shopify/inventory", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const connection = await connectionByOrg(db, organizationId);
  const rows = await loadSellableRows(db, organizationId);
  return c.json({
    connected: Boolean(connection),
    mode: connection?.mode ?? null,
    locationGid: connection?.shopifyLocationGid ?? null,
    rows,
  });
});

shopifyRoute.get("/shopify/locations", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const connection = await connectionByOrg(db, organizationId);
  if (!connection) return c.json([]);
  try {
    return c.json(await listShopifyLocationsForOrg(db, organizationId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list Shopify locations";
    conflict(message, "SHOPIFY_API");
  }
});

shopifyRoute.post("/shopify/inventory/sync", async (c) => {
  const body = await c.req.json<{ itemIds?: string[] }>().catch(() => ({}) as { itemIds?: string[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((id) => typeof id === "string") : undefined;
  const result = await syncShopifySellable(db, organizationId, { itemIds, strict: true });
  if (result.code === "NOT_CONNECTED") badRequest(result.error || "Shopify is not connected");
  if (result.code === "MISSING_LOCATION") conflict(result.error || "Set a Shopify location before pushing sellable qty.", "MISSING_LOCATION");
  return c.json(result);
});

shopifyRoute.get("/shopify/outbound", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(schema.shopifyOutboundEvents)
    .where(eq(schema.shopifyOutboundEvents.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.shopifyOutboundEvents.createdAt))
    .limit(25);
  return c.json(
    rows.map((row) => ({
      ...row,
      request: JSON.parse(row.requestJson) as unknown,
      response: row.responseJson ? (JSON.parse(row.responseJson) as unknown) : null,
    })),
  );
});
