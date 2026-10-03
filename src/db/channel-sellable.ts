import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { currentRequestScope } from "../lib/request-scope";
import { publicErrorText } from "../lib/db-errors";
import { ChannelApiError, etsySetListingQty, wooSetStock } from "../lib/channel-clients";
import { loadSellableRows } from "./shopify-sellable";
import { etsyAccessToken, etsyApp, wooCreds } from "./channel-sync";

/**
 * Pushes the same sellable qty Shopify already gets to a connected WooCommerce or Etsy shop.
 * Demo records the payload. A live failure is recorded and does not fail the stock post.
 * Etsy only updates listings saved from an order (`etsy_listing_id`).
 */
export async function syncChannelSellable(db: AppDb, organizationId: string, itemIds?: string[]): Promise<void> {
  const connections = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.organizationId, organizationId),
        eq(schema.channelConnections.status, "active"),
        inArray(schema.channelConnections.channel, ["woocommerce", "etsy"]),
      ),
    );
  if (connections.length === 0) return;

  const rows = await loadSellableRows(db, organizationId, itemIds);
  if (rows.length === 0) return;
  const listings = await db
    .select({ id: schema.items.id, etsyListingId: schema.items.etsyListingId })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, rows.map((row) => row.itemId))));
  const listingByItem = new Map(listings.map((row) => [row.id, row.etsyListingId]));
  const env = currentRequestScope()?.env;

  for (const conn of connections) {
    const payload = rows.map((row) => ({
      sku: row.sku,
      sellable: row.sellable,
      listingId: conn.channel === "etsy" ? listingByItem.get(row.itemId) ?? null : null,
    }));
    if (conn.mode !== "live") {
      await record(db, organizationId, conn.channel, "demo", { payload });
      continue;
    }
    if (!env) {
      await record(db, organizationId, conn.channel, "skipped", { error: "No request scope" });
      continue;
    }
    try {
      const skipped: { sku: string; reason: string }[] = [];
      if (conn.channel === "woocommerce") {
        const creds = await wooCreds(env, conn);
        for (const row of payload) {
          const result = await wooSetStock(creds, row.sku, row.sellable);
          if (result === "missing") skipped.push({ sku: row.sku, reason: "No WooCommerce product with this SKU" });
        }
      } else {
        if (!conn.externalShopId) {
          await record(db, organizationId, conn.channel, "failed", { error: "Etsy shop id is missing" });
          continue;
        }
        const { app, token } = await etsyAccessToken(db, env, conn);
        if (!etsyApp(env)) {
          await record(db, organizationId, conn.channel, "failed", { error: "ETSY_API_KEY is not set" });
          continue;
        }
        for (const row of payload) {
          if (!row.listingId) {
            skipped.push({ sku: row.sku, reason: "No Etsy listing yet. It is saved the next time that listing sells." });
            continue;
          }
          const result = await etsySetListingQty(app, token, row.listingId, row.sku, row.sellable);
          if (result === "missing") skipped.push({ sku: row.sku, reason: "Listing has no product with this SKU" });
        }
      }
      await record(db, organizationId, conn.channel, "ok", { payload, skipped });
    } catch (err) {
      const message = err instanceof ChannelApiError ? err.message : publicErrorText(err, "Channel stock push failed");
      await record(db, organizationId, conn.channel, "failed", { error: message, payload });
    }
  }
}

async function record(db: AppDb, organizationId: string, channel: string, status: string, response: unknown) {
  await db.insert(schema.shopifyOutboundEvents).values({
    id: newId(),
    organizationId,
    kind: `channelSellable:${channel}`,
    status,
    requestJson: "{}",
    responseJson: JSON.stringify(response),
    createdAt: Date.now(),
  });
}
