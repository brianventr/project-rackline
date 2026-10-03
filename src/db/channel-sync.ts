import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import type { Bindings } from "../lib/types";
import { channelSecret, openSecret, sealSecret } from "../lib/secret-box";
import { publicErrorText } from "../lib/db-errors";
import {
  etsyOpenReceipts,
  etsyPostTracking,
  etsyRefresh,
  wooListProcessing,
  wooMarkShipped,
  type EtsyApp,
  type WooCreds,
} from "../lib/channel-clients";
import { mapWooOrder } from "../domain/channels/woocommerce";
import { etsyTokenFresh, mapEtsyReceipt } from "../domain/channels/etsy";
import { postBackRoute, postsTrackingBack, type ChannelOrder, type ChannelSkip } from "../domain/channels/adapter";
import { channelWarehouseId, persistChannelOrder, skuIndex, type ChannelConnectionRow } from "./channel-ingest";

export type SyncSummary = { created: number; existing: number; skipped: number; missingSkus: string[] };

export class ChannelSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelSetupError";
  }
}

export function etsyApp(env: Bindings): EtsyApp | null {
  return env.ETSY_API_KEY ? { keystring: env.ETSY_API_KEY, sharedSecret: env.ETSY_SHARED_SECRET } : null;
}

export async function wooCreds(env: Bindings, conn: ChannelConnectionRow): Promise<WooCreds> {
  const secret = channelSecret(env);
  const consumerKey = await openSecret(secret, conn.apiKey);
  const consumerSecret = await openSecret(secret, conn.apiSecret);
  if (!conn.apiBase || !consumerKey || !consumerSecret) {
    throw new ChannelSetupError("WooCommerce keys are missing or unreadable. Reconnect the store.");
  }
  return { storeUrl: conn.apiBase, consumerKey, consumerSecret };
}

export async function etsyAccessToken(db: AppDb, env: Bindings, conn: ChannelConnectionRow): Promise<{ app: EtsyApp; token: string }> {
  const app = etsyApp(env);
  if (!app) throw new ChannelSetupError("ETSY_API_KEY is not set on this deployment.");
  const secret = channelSecret(env);
  const access = await openSecret(secret, conn.accessToken);
  if (access && etsyTokenFresh(conn.tokenExpiresAt, Date.now())) return { app, token: access };
  const refresh = await openSecret(secret, conn.refreshToken);
  if (!refresh) throw new ChannelSetupError("Etsy authorization expired. Reconnect the shop.");
  const next = await etsyRefresh(app, refresh);
  await db
    .update(schema.channelConnections)
    .set({
      accessToken: await sealSecret(secret, next.accessToken),
      refreshToken: await sealSecret(secret, next.refreshToken),
      tokenExpiresAt: next.expiresAt,
    })
    .where(eq(schema.channelConnections.id, conn.id));
  return { app, token: next.accessToken };
}

export async function ingestChannelOrders(
  db: AppDb,
  conn: ChannelConnectionRow,
  mapped: (ChannelOrder | ChannelSkip)[],
): Promise<SyncSummary> {
  const summary: SyncSummary = { created: 0, existing: 0, skipped: 0, missingSkus: [] };
  if (conn.channel !== "woocommerce" && conn.channel !== "etsy") return summary;
  const warehouseId = await channelWarehouseId(db, conn.organizationId, conn.warehouseId);
  if (!warehouseId) throw new ChannelSetupError("Add a building before connecting a sales channel.");
  const skus = await skuIndex(db, conn.organizationId);
  for (const order of mapped) {
    if ("skip" in order) {
      summary.skipped += 1;
      continue;
    }
    const result = await persistChannelOrder(db, {
      organizationId: conn.organizationId,
      warehouseId,
      channel: conn.channel,
      order,
      skus,
      createMissingItems: true,
    });
    if ("skipped" in result) summary.skipped += 1;
    else if (result.created) summary.created += 1;
    else summary.existing += 1;
  }
  return summary;
}

async function pullOrders(db: AppDb, env: Bindings, conn: ChannelConnectionRow): Promise<(ChannelOrder | ChannelSkip)[]> {
  const since = conn.lastSyncAt ? conn.lastSyncAt - 60 * 60 * 1000 : Date.now() - 14 * 24 * 60 * 60 * 1000;
  if (conn.channel === "woocommerce") {
    const orders = await wooListProcessing(await wooCreds(env, conn), new Date(since).toISOString());
    return orders.map(mapWooOrder);
  }
  if (conn.channel === "etsy") {
    if (!conn.externalShopId) throw new ChannelSetupError("Etsy shop id is missing. Reconnect the shop.");
    const { app, token } = await etsyAccessToken(db, env, conn);
    const receipts = await etsyOpenReceipts(app, token, conn.externalShopId, Math.floor(since / 1000));
    return receipts.map(mapEtsyReceipt);
  }
  return [];
}

/** Pulls open orders for one live connection and records the outcome on the connection row. */
export async function syncChannel(db: AppDb, env: Bindings, conn: ChannelConnectionRow): Promise<SyncSummary> {
  if (conn.mode !== "live" || conn.status !== "active") return { created: 0, existing: 0, skipped: 0, missingSkus: [] };
  try {
    const summary = await ingestChannelOrders(db, conn, await pullOrders(db, env, conn));
    await db
      .update(schema.channelConnections)
      .set({ lastSyncAt: Date.now(), lastSyncError: null })
      .where(eq(schema.channelConnections.id, conn.id));
    return summary;
  } catch (err) {
    const message = publicErrorText(err, "Sync failed");
    await db
      .update(schema.channelConnections)
      .set({ lastSyncError: message })
      .where(eq(schema.channelConnections.id, conn.id));
    throw err;
  }
}

/** Cron entry: every active live WooCommerce/Etsy connection, one at a time so a bad shop can't starve the rest. */
export async function runChannelCron(db: AppDb, env: Bindings): Promise<{ synced: number; failed: number }> {
  const rows = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.mode, "live"),
        eq(schema.channelConnections.status, "active"),
        inArray(schema.channelConnections.channel, ["woocommerce", "etsy"]),
      ),
    )
    .orderBy(asc(schema.channelConnections.lastSyncAt));
  let synced = 0;
  let failed = 0;
  for (const conn of rows) {
    try {
      await syncChannel(db, env, conn);
      synced += 1;
    } catch (err) {
      failed += 1;
      console.error("channel sync failed", conn.channel, conn.id, err);
    }
  }
  return { synced, failed };
}

/** `manual`: the channel has no live connection, so the owner marks the order shipped there. Never retried. */
export type ChannelFulfillResult = { status: "fulfilled" | "failed" | "manual" | "skipped"; error?: string };

async function trackingFor(db: AppDb, order: typeof schema.orders.$inferSelect) {
  if (order.trackingNumber) {
    return { trackingNumber: order.trackingNumber, company: order.trackingCompany, url: order.trackingUrl };
  }
  const [pkg] = await db
    .select()
    .from(schema.orderPackages)
    .where(and(eq(schema.orderPackages.orderId, order.id), isNotNull(schema.orderPackages.trackingNumber)))
    .limit(1);
  return pkg?.trackingNumber ? { trackingNumber: pkg.trackingNumber, company: pkg.trackingCompany, url: pkg.trackingUrl } : null;
}

/**
 * Posts tracking back to WooCommerce or Etsy after the order ships. Never throws: the order is
 * already shipped in Rackline, so a channel failure is recorded on the order for a retry. A channel
 * with no live connection records `manual` instead, since a retry could never reach it.
 */
export async function fulfillChannelOrder(
  db: AppDb,
  env: Bindings,
  organizationId: string,
  orderId: string,
): Promise<ChannelFulfillResult> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order || !postsTrackingBack(order.source) || !order.externalOrderId) return { status: "skipped" };
  if (order.channelSyncStatus === "fulfilled") return { status: "fulfilled" };

  const record = async (result: { status: "fulfilled" | "failed" | "manual"; error?: string }) => {
    await db
      .update(schema.orders)
      .set({
        channelSyncStatus: result.status,
        channelSyncError: result.error ?? null,
        channelFulfilledAt: result.status === "fulfilled" ? Date.now() : null,
      })
      .where(eq(schema.orders.id, order.id));
    return result;
  };

  const [conn] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.organizationId, organizationId), eq(schema.channelConnections.channel, order.source)))
    .limit(1);
  const route = postBackRoute(conn);
  if (!conn || route === "not_connected") return record({ status: "failed", error: "Channel is not connected." });
  if (route === "demo") return record({ status: "fulfilled" });
  if (route === "manual") return record({ status: "manual" });

  const tracking = await trackingFor(db, order);
  if (!tracking) return record({ status: "failed", error: "No tracking number to post back." });

  try {
    if (conn.channel === "woocommerce") {
      await wooMarkShipped(await wooCreds(env, conn), order.externalOrderId, tracking);
    } else {
      if (!conn.externalShopId) throw new ChannelSetupError("Etsy shop id is missing. Reconnect the shop.");
      const { app, token } = await etsyAccessToken(db, env, conn);
      await etsyPostTracking(app, token, {
        shopId: conn.externalShopId,
        receiptId: order.externalOrderId,
        trackingNumber: tracking.trackingNumber,
        company: tracking.company,
      });
    }
    return record({ status: "fulfilled" });
  } catch (err) {
    return record({ status: "failed", error: publicErrorText(err, "Tracking post-back failed") });
  }
}
