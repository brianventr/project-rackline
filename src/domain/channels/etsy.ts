import { destColumns, formatShipToAddress, resolveFromText, resolvePlace } from "../geo";
import { carrierNameForChannel, type ChannelOrder, type ChannelSkip } from "./adapter";

export const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_API = "https://openapi.etsy.com/v3/application";
export const ETSY_SCOPES = ["transactions_r", "transactions_w", "shops_r"];

export type EtsyReceipt = {
  receipt_id?: number | string | null;
  name?: string | null;
  buyer_user_id?: number | string | null;
  /** Only sent to apps Etsy has approved for buyer email. */
  buyer_email?: string | null;
  first_line?: string | null;
  second_line?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country_iso?: string | null;
  is_paid?: boolean | null;
  is_shipped?: boolean | null;
  status?: string | null;
  transactions?: {
    transaction_id?: number | string | null;
    title?: string | null;
    quantity?: number | null;
    sku?: string | null;
    listing_id?: number | string | null;
  }[];
};

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function etsyAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: ETSY_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTHORIZE_URL}?${params.toString()}`;
}

/** Etsy access tokens are prefixed with the numeric user id (`12345.abc…`). */
export function etsyUserIdFromToken(token: string): string | null {
  const [head] = token.split(".");
  return head && /^\d+$/.test(head) ? head : null;
}

/** Etsy's `x-api-key` header is `keystring:shared_secret` when a shared secret is configured. */
export function etsyApiKeyHeader(keystring: string, sharedSecret?: string | null): string {
  return sharedSecret ? `${keystring}:${sharedSecret}` : keystring;
}

export function mapEtsyReceipt(receipt: EtsyReceipt): ChannelOrder | ChannelSkip {
  if (receipt.receipt_id == null) return { skip: true, reason: "missing_id" };
  if (receipt.is_paid === false) return { skip: true, reason: "unpaid" };
  if (receipt.is_shipped) return { skip: true, reason: "already_shipped" };
  if (receipt.status && ["canceled", "cancelled", "fully refunded"].includes(receipt.status.toLowerCase())) {
    return { skip: true, reason: "cancelled" };
  }

  const lines: ChannelOrder["lines"] = [];
  for (const tx of receipt.transactions ?? []) {
    const qty = Number(tx.quantity ?? 0);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const sku = tx.sku?.trim() || (tx.listing_id != null ? `ETSY-${tx.listing_id}` : "");
    if (!sku) continue;
    lines.push({
      sku,
      title: (tx.title || sku).trim(),
      qty,
      externalLineId: tx.transaction_id != null ? String(tx.transaction_id) : null,
    });
  }
  if (lines.length === 0) return { skip: true, reason: "no_fulfillable_lines" };

  const shipToAddress = formatShipToAddress({
    address1: receipt.first_line,
    address2: receipt.second_line,
    city: receipt.city,
    region: receipt.state,
    postal: receipt.zip,
    country: receipt.country_iso,
  });
  const place =
    resolvePlace({
      city: receipt.city ?? undefined,
      region: receipt.state ?? undefined,
      postal: receipt.zip ?? undefined,
      country: receipt.country_iso ?? undefined,
    }) ?? resolveFromText(shipToAddress);

  const externalId = String(receipt.receipt_id);
  return {
    externalId,
    externalName: `Etsy ${externalId}`,
    customerName: receipt.name?.trim() || "Etsy buyer",
    customerEmail: receipt.buyer_email?.trim() || null,
    customerRef: receipt.buyer_user_id != null ? String(receipt.buyer_user_id) : null,
    shipToAddress,
    dest: destColumns(place),
    lines,
  };
}

export function etsyShipmentBody(input: { trackingNumber: string; company: string | null }): URLSearchParams {
  return new URLSearchParams({
    tracking_code: input.trackingNumber,
    carrier_name: carrierNameForChannel(input.company),
    send_bcc: "true",
  });
}

/** Refresh a minute early so a poll never races the expiry. */
export function etsyTokenFresh(expiresAt: number | null | undefined, now: number): boolean {
  return Boolean(expiresAt && expiresAt - 60_000 > now);
}
