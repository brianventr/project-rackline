import { destColumns, formatShipToAddress, resolveFromText, resolvePlace } from "../geo";
import { shopifyHmac, verifyShopifyHmac } from "../shopify";
import type { ChannelOrder, ChannelSkip } from "./adapter";

export type WooAddress = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  email?: string | null;
};

export type WooOrder = {
  id?: number | string | null;
  number?: string | null;
  status?: string | null;
  /** 0 for guest checkout. */
  customer_id?: number | string | null;
  billing?: WooAddress | null;
  shipping?: WooAddress | null;
  line_items?: {
    id?: number | string | null;
    name?: string | null;
    sku?: string | null;
    quantity?: number | null;
    product_id?: number | string | null;
    variation_id?: number | string | null;
  }[];
};

/** Only paid, not-yet-shipped orders become pick tickets. */
export const WOO_PICKABLE_STATUS = "processing";

function personName(addr: WooAddress | null | undefined): string {
  return [addr?.first_name, addr?.last_name].filter(Boolean).join(" ").trim();
}

function hasStreet(addr: WooAddress | null | undefined): addr is WooAddress {
  return Boolean(addr?.address_1 || addr?.city);
}

export function mapWooOrder(order: WooOrder): ChannelOrder | ChannelSkip {
  if (order.id == null) return { skip: true, reason: "missing_id" };
  if (order.status !== WOO_PICKABLE_STATUS) return { skip: true, reason: order.status || "no_status" };

  const lines: ChannelOrder["lines"] = [];
  for (const line of order.line_items ?? []) {
    const qty = Number(line.quantity ?? 0);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const productRef = line.variation_id && Number(line.variation_id) > 0 ? line.variation_id : line.product_id;
    const sku = line.sku?.trim() || (productRef != null ? `WOO-${productRef}` : "");
    if (!sku) continue;
    lines.push({
      sku,
      title: (line.name || sku).trim(),
      qty,
      externalLineId: line.id != null ? String(line.id) : null,
    });
  }
  if (lines.length === 0) return { skip: true, reason: "no_fulfillable_lines" };

  const addr = hasStreet(order.shipping) ? order.shipping : order.billing;
  const shipToAddress = addr
    ? formatShipToAddress({
        address1: addr.address_1,
        address2: addr.address_2,
        city: addr.city,
        region: addr.state,
        postal: addr.postcode,
        country: addr.country,
      })
    : null;
  const place =
    (addr &&
      resolvePlace({
        city: addr.city ?? undefined,
        region: addr.state ?? undefined,
        postal: addr.postcode ?? undefined,
        country: addr.country ?? undefined,
      })) ||
    resolveFromText(shipToAddress);

  const externalId = String(order.id);
  return {
    externalId,
    externalName: `#${order.number?.trim() || externalId}`,
    customerName: personName(order.shipping) || personName(order.billing) || order.shipping?.company || "WooCommerce customer",
    customerEmail: order.billing?.email?.trim() || null,
    customerRef: order.customer_id != null && Number(order.customer_id) > 0 ? String(order.customer_id) : null,
    shipToAddress,
    dest: destColumns(place),
    lines,
  };
}

/** WooCommerce signs webhook bodies as base64(HMAC-SHA256(body, secret)), the same scheme Shopify uses. */
export function signWooBody(secret: string, body: string): Promise<string> {
  return shopifyHmac(secret, body);
}

export function verifyWooSignature(secret: string, body: string, header: string | undefined): Promise<boolean> {
  return verifyShopifyHmac(secret, body, header);
}

/** WooCommerce pings a new webhook with a form body (`webhook_id=12`) before any order arrives. */
export function isWooPing(body: string, contentType: string | undefined): boolean {
  return !contentType?.includes("json") && /^webhook_id=\d+/.test(body.trim());
}

export function normalizeWooStoreUrl(input: string): string {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Store URL is required");
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Store URL must use https");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function wooApiUrl(storeUrl: string, path: string): string {
  return `${storeUrl}/wp-json/wc/v3/${path.replace(/^\/+/, "")}`;
}

export function wooTrackingNote(input: { trackingNumber: string; company: string | null; url: string | null }): {
  note: string;
  customer_note: true;
} {
  const carrier = input.company ? `${input.company} ` : "";
  const link = input.url ? ` ${input.url}` : "";
  return { note: `Shipped via ${carrier}tracking ${input.trackingNumber}.${link}`.trim(), customer_note: true };
}

export function wooCompleteBody(): { status: "completed" } {
  return { status: "completed" };
}

export function wooWebhookBody(input: { deliveryUrl: string; secret: string }) {
  return {
    name: "Rackline orders",
    topic: "order.updated",
    delivery_url: input.deliveryUrl,
    secret: input.secret,
    status: "active",
  };
}
