import { etsyInventoryWithQty, wooStockBody, type EtsyInventory } from "../domain/channel-sellable";
import {
  ETSY_API,
  ETSY_TOKEN_URL,
  etsyApiKeyHeader,
  etsyShipmentBody,
  type EtsyReceipt,
} from "../domain/channels/etsy";
import {
  wooApiUrl,
  wooCompleteBody,
  wooTrackingNote,
  wooWebhookBody,
  type WooOrder,
} from "../domain/channels/woocommerce";

export class ChannelApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ChannelApiError";
  }
}

async function readError(res: Response, label: string): Promise<ChannelApiError> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 200);
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; error_description?: string };
    detail = json.message || json.error_description || json.error || detail;
  } catch {
    // Non-JSON error bodies are shown as-is.
  }
  return new ChannelApiError(`${label} returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
}

export type WooCreds = { storeUrl: string; consumerKey: string; consumerSecret: string };

async function wooFetch<T>(creds: WooCreds, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(wooApiUrl(creds.storeUrl, path), {
    ...init,
    headers: {
      authorization: `Basic ${btoa(`${creds.consumerKey}:${creds.consumerSecret}`)}`,
      "content-type": "application/json",
      accept: "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw await readError(res, "WooCommerce");
  return (await res.json()) as T;
}

export function wooListProcessing(creds: WooCreds, afterIso?: string | null): Promise<WooOrder[]> {
  const params = new URLSearchParams({ status: "processing", per_page: "50", orderby: "date", order: "asc" });
  if (afterIso) params.set("modified_after", afterIso);
  return wooFetch<WooOrder[]>(creds, `orders?${params.toString()}`);
}

export async function wooMarkShipped(
  creds: WooCreds,
  orderId: string,
  tracking: { trackingNumber: string; company: string | null; url: string | null },
): Promise<void> {
  await wooFetch(creds, `orders/${encodeURIComponent(orderId)}/notes`, {
    method: "POST",
    body: JSON.stringify(wooTrackingNote(tracking)),
  });
  await wooFetch(creds, `orders/${encodeURIComponent(orderId)}`, {
    method: "PUT",
    body: JSON.stringify(wooCompleteBody()),
  });
}

/** Sets stock on the product whose SKU matches. Variations that Woo does not return by SKU are skipped. */
export async function wooSetStock(creds: WooCreds, sku: string, qty: number): Promise<"updated" | "missing"> {
  const products = await wooFetch<{ id: number; sku?: string | null }[]>(
    creds,
    `products?sku=${encodeURIComponent(sku)}&per_page=5`,
  );
  const want = sku.trim().toLowerCase();
  const product = products.find((row) => (row.sku ?? "").trim().toLowerCase() === want) ?? null;
  if (!product) return "missing";
  await wooFetch(creds, `products/${product.id}`, { method: "PUT", body: JSON.stringify(wooStockBody(qty)) });
  return "updated";
}

export async function wooCreateWebhook(creds: WooCreds, deliveryUrl: string, secret: string): Promise<string> {
  const row = await wooFetch<{ id: number }>(creds, "webhooks", {
    method: "POST",
    body: JSON.stringify(wooWebhookBody({ deliveryUrl, secret })),
  });
  return String(row.id);
}

export type EtsyApp = { keystring: string; sharedSecret?: string | null };
export type EtsyTokens = { accessToken: string; refreshToken: string; expiresAt: number };

async function etsyToken(app: EtsyApp, body: Record<string, string>): Promise<EtsyTokens> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.keystring, ...body }),
  });
  if (!res.ok) throw await readError(res, "Etsy OAuth");
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

export function etsyExchangeCode(
  app: EtsyApp,
  input: { code: string; verifier: string; redirectUri: string },
): Promise<EtsyTokens> {
  return etsyToken(app, {
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  });
}

export function etsyRefresh(app: EtsyApp, refreshToken: string): Promise<EtsyTokens> {
  return etsyToken(app, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function etsyFetch<T>(app: EtsyApp, accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ETSY_API}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      "x-api-key": etsyApiKeyHeader(app.keystring, app.sharedSecret),
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw await readError(res, "Etsy");
  return (await res.json()) as T;
}

export async function etsyShopForUser(
  app: EtsyApp,
  accessToken: string,
  userId: string,
): Promise<{ shopId: string; shopName: string }> {
  const shop = await etsyFetch<{ shop_id: number; shop_name: string }>(app, accessToken, `users/${userId}/shops`);
  return { shopId: String(shop.shop_id), shopName: shop.shop_name };
}

export async function etsyOpenReceipts(
  app: EtsyApp,
  accessToken: string,
  shopId: string,
  minCreatedSec?: number,
): Promise<EtsyReceipt[]> {
  const params = new URLSearchParams({ was_paid: "true", was_shipped: "false", was_canceled: "false", limit: "100" });
  if (minCreatedSec) params.set("min_created", String(minCreatedSec));
  const page = await etsyFetch<{ results: EtsyReceipt[] }>(app, accessToken, `shops/${shopId}/receipts?${params.toString()}`);
  return page.results ?? [];
}

/** Replaces the offering quantity for `sku` on a listing Rackline has already seen. */
export async function etsySetListingQty(
  app: EtsyApp,
  accessToken: string,
  listingId: string,
  sku: string,
  qty: number,
): Promise<"updated" | "missing"> {
  const inventory = await etsyFetch<EtsyInventory>(app, accessToken, `listings/${encodeURIComponent(listingId)}/inventory`);
  const next = etsyInventoryWithQty(inventory, sku, qty);
  if (!next) return "missing";
  await etsyFetch(app, accessToken, `listings/${encodeURIComponent(listingId)}/inventory`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
  return "updated";
}

export async function etsyPostTracking(
  app: EtsyApp,
  accessToken: string,
  input: { shopId: string; receiptId: string; trackingNumber: string; company: string | null },
): Promise<void> {
  await etsyFetch(app, accessToken, `shops/${input.shopId}/receipts/${input.receiptId}/tracking`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: etsyShipmentBody(input),
  });
}
