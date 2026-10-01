/** Signed outbound events. The header is the hex HMAC-SHA256 of the raw JSON body. */

export const WEBHOOK_EVENTS = ["order.created", "order.shipped", "stock.changed"] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function urlSafeFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += URL_SAFE[byte % URL_SAFE.length]!;
  return out;
}

/** `rk_live_` plus 32 url-safe characters. The full value is returned once; only its hash is stored. */
export function newApiSecret(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  return `rk_live_${urlSafeFromBytes(bytes)}`;
}

export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, 12);
}

export function newWebhookSecret(): string {
  return `whsec_${urlSafeFromBytes(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function parseWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter an https URL");
  }
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:") return url.toString();
  if (localhost && url.protocol === "http:") return url.toString();
  throw new Error("Webhook URLs must be https, except localhost");
}

export function parseWebhookEvents(value: unknown): WebhookEventName[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Choose at least one event");
  const events = [...new Set(value.filter((item): item is WebhookEventName => (WEBHOOK_EVENTS as readonly string[]).includes(String(item))))];
  if (events.length === 0 || events.length !== value.length) {
    throw new Error("Events must be order.created, order.shipped, or stock.changed");
  }
  return events;
}

export function storedEvents(value: string | null | undefined): WebhookEventName[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WebhookEventName => (WEBHOOK_EVENTS as readonly string[]).includes(String(item)));
  } catch {
    return [];
  }
}

export type WebhookOrderLine = { sku: string; qty: number };

export type WebhookPayload = {
  event: WebhookEventName;
  createdAt: string;
  order?: {
    number: string;
    status: string;
    city?: string | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    lines?: WebhookOrderLine[];
  };
  changes?: { sku: string; qty: number; type: string }[];
};

export function orderCreatedPayload(input: {
  number: string;
  status: string;
  city?: string | null;
  lines: WebhookOrderLine[];
  createdAt?: string;
}): WebhookPayload {
  return {
    event: "order.created",
    createdAt: input.createdAt ?? new Date().toISOString(),
    order: {
      number: input.number,
      status: input.status,
      city: input.city ?? null,
      lines: input.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
    },
  };
}

export function orderShippedPayload(input: {
  number: string;
  status: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  createdAt?: string;
}): WebhookPayload {
  return {
    event: "order.shipped",
    createdAt: input.createdAt ?? new Date().toISOString(),
    order: {
      number: input.number,
      status: input.status,
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
    },
  };
}

export function stockChangedPayload(input: {
  changes: { sku: string; qty: number; type: string }[];
  createdAt?: string;
}): WebhookPayload {
  return {
    event: "stock.changed",
    createdAt: input.createdAt ?? new Date().toISOString(),
    changes: input.changes.map((change) => ({ sku: change.sku, qty: change.qty, type: change.type })),
  };
}

export function serializeWebhookPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(new Uint8Array(sig));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** What a receiver does: HMAC the raw body and compare it to `Rackline-Signature`. */
export async function verifyWebhookSignature(secret: string, body: string, header: string | null | undefined): Promise<boolean> {
  if (!header) return false;
  const expected = await signWebhookBody(secret, body);
  return timingSafeEqual(expected, header.trim().toLowerCase());
}
