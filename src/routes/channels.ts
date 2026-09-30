import { Hono } from "hono";
import { and, count, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { originFrom, type AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { csvChannelOrders, parseChannelCsv, type ChannelKind } from "../domain/channel-import";
import {
  CHANNELS,
  channelHealth,
  channelOrder,
  isChannelId,
  type ChannelId,
} from "../domain/channels/adapter";
import {
  isWooPing,
  mapWooOrder,
  normalizeWooStoreUrl,
  verifyWooSignature,
  type WooOrder,
} from "../domain/channels/woocommerce";
import {
  etsyAuthorizeUrl,
  etsyUserIdFromToken,
  mapEtsyReceipt,
  pkceChallenge,
  randomVerifier,
  type EtsyReceipt,
} from "../domain/channels/etsy";
import { parseOperatingMode } from "../domain/operating-mode";
import { channelSecret, openSecret, sealSecret } from "../lib/secret-box";
import { ChannelApiError, etsyExchangeCode, etsyShopForUser, wooCreateWebhook, wooListProcessing } from "../lib/channel-clients";
import { channelWarehouseId, persistChannelOrder, skuIndex, type ChannelConnectionRow } from "../db/channel-ingest";
import {
  ChannelSetupError,
  etsyApp,
  fulfillChannelOrder,
  ingestChannelOrders,
  syncChannel,
} from "../db/channel-sync";

export const channelsRoute = new Hono<AppEnv>();
export const channelsPublicRoute = new Hono<AppEnv>();

type Db = AppEnv["Variables"]["db"];
type ManagedChannel = Exclude<ChannelId, "shopify">;

const CSV_CHANNELS: ChannelKind[] = ["etsy", "faire"];
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function managedChannel(value: string): ManagedChannel {
  if (!isChannelId(value) || value === "shopify") badRequest("Channel must be woocommerce, etsy, or faire");
  return value as ManagedChannel;
}

function webhookUrl(origin: string, row: ChannelConnectionRow): string {
  return `${origin}/api/channels/woocommerce/webhook/${row.id}`;
}

async function connectionFor(db: Db, organizationId: string, channel: ManagedChannel) {
  const [row] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.organizationId, organizationId), eq(schema.channelConnections.channel, channel)))
    .limit(1);
  return row ?? null;
}

async function upsertConnection(
  db: Db,
  organizationId: string,
  channel: ManagedChannel,
  patch: Partial<typeof schema.channelConnections.$inferInsert>,
): Promise<ChannelConnectionRow> {
  const existing = await connectionFor(db, organizationId, channel);
  if (existing) {
    await db.update(schema.channelConnections).set(patch).where(eq(schema.channelConnections.id, existing.id));
  } else {
    await db.insert(schema.channelConnections).values({
      id: newId(),
      organizationId,
      channel,
      status: "active",
      createdAt: Date.now(),
      ...patch,
    });
  }
  return (await connectionFor(db, organizationId, channel))!;
}

function asHttp(err: unknown): never {
  if (err instanceof ChannelSetupError) conflict(err.message, "CHANNEL_SETUP");
  if (err instanceof ChannelApiError) {
    if (err.status === 401 || err.status === 403) conflict(err.message, "CHANNEL_AUTH");
    conflict(err.message, "CHANNEL_API");
  }
  throw err;
}

channelsRoute.get("/channels", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const origin = originFrom(c.req.url);
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const mode = parseOperatingMode(org?.operatingMode);
  const rows = await db
    .select()
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.organizationId, organizationId));
  const [shopify] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  const openBySource = await db
    .select({ source: schema.orders.source, n: count() })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        inArray(schema.orders.status, ["open", "picking", "picked", "packing", "packed"]),
      ),
    )
    .groupBy(schema.orders.source);
  const failedBySource = await db
    .select({ source: schema.orders.source, n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.channelSyncStatus, "failed")))
    .groupBy(schema.orders.source);
  const tally = (list: { source: string; n: number }[], source: string) => list.find((r) => r.source === source)?.n ?? 0;

  return c.json({
    operatingMode: mode,
    channels: channelOrder(mode).map((id) => {
      const info = CHANNELS[id];
      if (id === "shopify") {
        const view = shopify
          ? { status: "active", mode: shopify.mode, lastSyncAt: shopify.updatedAt, lastSyncError: null }
          : null;
        return {
          ...info,
          health: channelHealth(info, view),
          mode: shopify?.mode ?? null,
          externalShop: shopify?.shopDomain ?? null,
          lastSyncAt: null,
          lastSyncError: null,
          webhookUrl: null,
          configured: true,
          openOrders: tally(openBySource, id),
          failedPostBacks: 0,
          setupPath: "/setup/shopify",
        };
      }
      const row = rows.find((r) => r.channel === id) ?? null;
      return {
        ...info,
        health: channelHealth(info, row),
        mode: row?.mode ?? null,
        externalShop: row?.externalShop ?? null,
        lastSyncAt: row?.lastSyncAt ?? null,
        lastSyncError: row?.lastSyncError ?? null,
        webhookUrl: id === "woocommerce" && row?.mode === "live" ? webhookUrl(origin, row) : null,
        configured: id === "etsy" ? Boolean(etsyApp(c.env)) : true,
        openOrders: tally(openBySource, id),
        failedPostBacks: tally(failedBySource, id),
        setupPath: "/setup/channels",
      };
    }),
  });
});

channelsRoute.put("/channels/:channel", async (c) => {
  requireOwner(c.get("role"));
  const channel = managedChannel(c.req.param("channel"));
  const body = await c.req.json<{ externalShop?: string; status?: string }>();
  const existing = await connectionFor(c.get("db"), c.get("organizationId")!, channel);
  const row = await upsertConnection(c.get("db"), c.get("organizationId")!, channel, {
    externalShop: body.externalShop?.trim() || existing?.externalShop || null,
    status: body.status === "paused" ? "paused" : "active",
  });
  return c.json({ id: row.id, channel, connected: true });
});

channelsRoute.delete("/channels/:channel", async (c) => {
  requireOwner(c.get("role"));
  const channel = managedChannel(c.req.param("channel"));
  const row = await connectionFor(c.get("db"), c.get("organizationId")!, channel);
  if (!row) notFound("Channel is not connected");
  await c
    .get("db")
    .update(schema.channelConnections)
    .set({
      status: "disconnected",
      mode: "csv",
      apiKey: null,
      apiSecret: null,
      webhookSecret: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      oauthState: null,
      oauthVerifier: null,
      lastSyncError: null,
    })
    .where(eq(schema.channelConnections.id, row.id));
  return c.json({ channel, connected: false });
});

channelsRoute.post("/channels/woocommerce/connect", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ storeUrl?: string; consumerKey?: string; consumerSecret?: string; warehouseId?: string }>();
  let storeUrl: string;
  try {
    storeUrl = normalizeWooStoreUrl(requireString(body.storeUrl, "storeUrl"));
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid store URL");
  }
  const consumerKey = requireString(body.consumerKey, "consumerKey");
  const consumerSecret = requireString(body.consumerSecret, "consumerSecret");
  const creds = { storeUrl, consumerKey, consumerSecret };
  try {
    await wooListProcessing(creds);
  } catch (err) {
    asHttp(err);
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const secret = channelSecret(c.env);
  const hookSecret = randomVerifier();
  const row = await upsertConnection(db, organizationId, "woocommerce", {
    status: "active",
    mode: "live",
    apiBase: storeUrl,
    externalShop: new URL(storeUrl).host,
    apiKey: await sealSecret(secret, consumerKey),
    apiSecret: await sealSecret(secret, consumerSecret),
    webhookSecret: await sealSecret(secret, hookSecret),
    warehouseId: (await channelWarehouseId(db, organizationId, body.warehouseId)) ?? null,
    lastSyncError: null,
  });
  const deliveryUrl = webhookUrl(originFrom(c.req.url), row);
  let webhookCreated = false;
  try {
    await wooCreateWebhook(creds, deliveryUrl, hookSecret);
    webhookCreated = true;
  } catch {
    // Keys without write scope can still pull; the page shows the URL to add by hand.
  }
  const summary = await syncChannel(db, c.env, row).catch(() => null);
  return c.json({ channel: "woocommerce", connected: true, webhookUrl: deliveryUrl, webhookCreated, sync: summary });
});

channelsRoute.post("/channels/etsy/connect", async (c) => {
  requireOwner(c.get("role"));
  const app = etsyApp(c.env);
  if (!app) conflict("Etsy is not configured on this deployment (ETSY_API_KEY).", "ETSY_NOT_CONFIGURED");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const verifier = randomVerifier();
  const state = `${Date.now()}.${randomVerifier()}`;
  await upsertConnection(db, organizationId, "etsy", {
    oauthState: state,
    oauthVerifier: await sealSecret(channelSecret(c.env), verifier),
  });
  const url = etsyAuthorizeUrl({
    clientId: app.keystring,
    redirectUri: `${originFrom(c.req.url)}/api/channels/etsy/oauth/callback`,
    state,
    challenge: await pkceChallenge(verifier),
  });
  return c.json({ url });
});

function sampleWooOrder(skus: string[], seq: number): WooOrder {
  return {
    id: 90000 + seq,
    number: String(90000 + seq),
    status: "processing",
    shipping: {
      first_name: "Rosa",
      last_name: "Diaz",
      address_1: "215 Water St",
      city: "Brooklyn",
      state: "NY",
      postcode: "11201",
      country: "US",
    },
    line_items: skus.map((sku, i) => ({ id: seq * 10 + i, name: sku, sku, quantity: 1 })),
  };
}

function sampleEtsyReceipt(skus: string[], seq: number): EtsyReceipt {
  return {
    receipt_id: 3100000000 + seq,
    name: "Jordan Lee",
    first_line: "88 Alder Ave",
    city: "Portland",
    state: "OR",
    zip: "97205",
    country_iso: "US",
    is_paid: true,
    is_shipped: false,
    transactions: skus.map((sku, i) => ({ transaction_id: seq * 10 + i, title: sku, quantity: 1, sku })),
  };
}

channelsRoute.post("/channels/:channel/demo", async (c) => {
  requireOwner(c.get("role"));
  const channel = managedChannel(c.req.param("channel"));
  if (channel === "faire") badRequest("Faire imports by CSV; paste an export instead");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await connectionFor(db, organizationId, channel);
  if (existing?.mode === "live" && existing.status === "active") {
    conflict("This channel is connected live; disconnect it before sending sample orders.", "CHANNEL_LIVE");
  }
  const row = await upsertConnection(db, organizationId, channel, {
    status: "active",
    mode: "demo",
    externalShop: existing?.externalShop || (channel === "etsy" ? "Demo Etsy shop" : "demo-store.example"),
  });
  const items = await db
    .select({ sku: schema.items.sku })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.type, "finished")))
    .limit(2);
  if (!items.length) conflict("Add a finished-good SKU before sending a sample order.", "NO_SKUS");
  const seq = Math.floor(Date.now() / 1000) % 100000;
  const skus = items.map((i) => i.sku);
  const mapped = channel === "woocommerce" ? mapWooOrder(sampleWooOrder(skus, seq)) : mapEtsyReceipt(sampleEtsyReceipt(skus, seq));
  try {
    const summary = await ingestChannelOrders(db, row, [mapped]);
    return c.json({ channel, mode: "demo", ...summary }, 201);
  } catch (err) {
    asHttp(err);
  }
});

channelsRoute.post("/channels/:channel/sync", async (c) => {
  requireOwner(c.get("role"));
  const channel = managedChannel(c.req.param("channel"));
  const row = await connectionFor(c.get("db"), c.get("organizationId")!, channel);
  if (!row || row.status !== "active" || row.mode !== "live") {
    conflict("Connect this channel live before syncing.", "CHANNEL_NOT_LIVE");
  }
  try {
    return c.json({ channel, ...(await syncChannel(c.get("db"), c.env, row)) });
  } catch (err) {
    asHttp(err);
  }
});

channelsRoute.post("/channels/orders/:id/post-back", async (c) => {
  const result = await fulfillChannelOrder(c.get("db"), c.env, c.get("organizationId")!, c.req.param("id"));
  if (result.status === "skipped") conflict("This order has no channel to post tracking to.", "NO_CHANNEL");
  return c.json(result);
});

channelsRoute.post("/channels/:channel/import", async (c) => {
  requireOwner(c.get("role"));
  const channel = c.req.param("channel");
  if (!CSV_CHANNELS.includes(channel as ChannelKind)) badRequest("CSV import is for etsy or faire");
  const kind = channel as ChannelKind;
  const body = await c.req.json<{ csv?: string; warehouseId?: string }>();
  const parsed = parseChannelCsv(kind, typeof body.csv === "string" ? body.csv : "");
  if (parsed.errors.length && parsed.rows.length === 0) badRequest(parsed.errors.join("; "));

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  if (body.warehouseId && !(await channelWarehouseId(db, organizationId, body.warehouseId))) {
    badRequest("Warehouse not found");
  }
  const warehouseId = await channelWarehouseId(db, organizationId, body.warehouseId);
  if (!warehouseId) conflict("No warehouse", "NO_WAREHOUSE");
  const existing = await connectionFor(db, organizationId, kind);
  if (!existing || existing.status === "disconnected") {
    await upsertConnection(db, organizationId, kind, { status: "active", mode: existing?.mode === "live" ? "live" : "csv" });
  }

  const skus = await skuIndex(db, organizationId);
  const created: { id: string; number: string; externalId: string }[] = [];
  const missing = new Set<string>();
  let duplicates = 0;
  for (const order of csvChannelOrders(kind, parsed.rows)) {
    const result = await persistChannelOrder(db, {
      organizationId,
      warehouseId,
      channel: kind,
      order,
      skus,
      createMissingItems: false,
    });
    for (const sku of result.missingSkus) missing.add(sku);
    if ("skipped" in result) continue;
    if (result.created) created.push({ id: result.orderId, number: result.number, externalId: order.externalId });
    else duplicates += 1;
  }

  if (created.length === 0) {
    if (missing.size) conflict(`Unknown SKUs: ${[...missing].join(", ")}`, "MISSING_SKUS");
    if (duplicates) conflict(`All ${duplicates} orders were already imported`, "ALREADY_IMPORTED");
    badRequest("No orders imported");
  }

  return c.json(
    {
      channel: kind,
      created: created.length,
      duplicates,
      orders: created,
      missingSkus: [...missing].sort(),
      parseErrors: parsed.errors,
    },
    201,
  );
});

channelsPublicRoute.post("/channels/woocommerce/webhook/:connectionId", async (c) => {
  const db = c.get("db");
  const raw = await c.req.text();
  if (isWooPing(raw, c.req.header("content-type"))) return c.json({ ok: true });
  const [conn] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.id, c.req.param("connectionId")), eq(schema.channelConnections.channel, "woocommerce")))
    .limit(1);
  if (!conn || conn.mode !== "live") return c.json({ error: "Unknown connection" }, 404);
  const secret = await openSecret(channelSecret(c.env), conn.webhookSecret);
  if (!secret || !(await verifyWooSignature(secret, raw, c.req.header("x-wc-webhook-signature")))) {
    return c.json({ error: "Invalid signature" }, 401);
  }
  if (conn.status !== "active") return c.json({ ok: true, skipped: "paused" });
  let payload: WooOrder;
  try {
    payload = JSON.parse(raw) as WooOrder;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const summary = await ingestChannelOrders(db, conn, [mapWooOrder(payload)]);
  return c.json({ ok: true, ...summary });
});

function channelsRedirect(origin: string, query: string): string {
  return `${origin}/setup/channels?${query}`;
}

channelsPublicRoute.get("/channels/etsy/oauth/callback", async (c) => {
  const origin = originFrom(c.req.url);
  const params = new URL(c.req.url).searchParams;
  const app = etsyApp(c.env);
  const state = params.get("state")?.trim();
  const code = params.get("code")?.trim();
  if (!app) return c.redirect(channelsRedirect(origin, "etsy=error&reason=missing_app"));
  if (params.get("error")) return c.redirect(channelsRedirect(origin, "etsy=error&reason=denied"));
  if (!state || !code) return c.redirect(channelsRedirect(origin, "etsy=error&reason=state"));
  const issuedAt = Number(state.split(".")[0]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > OAUTH_STATE_TTL_MS) {
    return c.redirect(channelsRedirect(origin, "etsy=error&reason=expired"));
  }

  const db = c.get("db");
  const [conn] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.oauthState, state), eq(schema.channelConnections.channel, "etsy")))
    .limit(1);
  if (!conn) return c.redirect(channelsRedirect(origin, "etsy=error&reason=state"));
  const secret = channelSecret(c.env);
  const verifier = await openSecret(secret, conn.oauthVerifier);
  if (!verifier) return c.redirect(channelsRedirect(origin, "etsy=error&reason=state"));

  try {
    const tokens = await etsyExchangeCode(app, {
      code,
      verifier,
      redirectUri: `${origin}/api/channels/etsy/oauth/callback`,
    });
    const userId = etsyUserIdFromToken(tokens.accessToken);
    if (!userId) throw new Error("Etsy token has no user id");
    const shop = await etsyShopForUser(app, tokens.accessToken, userId);
    await db
      .update(schema.channelConnections)
      .set({
        status: "active",
        mode: "live",
        externalShop: shop.shopName,
        externalShopId: shop.shopId,
        accessToken: await sealSecret(secret, tokens.accessToken),
        refreshToken: await sealSecret(secret, tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        oauthState: null,
        oauthVerifier: null,
        lastSyncError: null,
      })
      .where(eq(schema.channelConnections.id, conn.id));
  } catch (err) {
    console.error("etsy oauth failed", err);
    return c.redirect(channelsRedirect(origin, "etsy=error&reason=token"));
  }
  return c.redirect(channelsRedirect(origin, "etsy=connected"));
});
