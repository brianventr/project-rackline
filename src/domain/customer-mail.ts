import { isEmailAddress } from "./purchase-mail";
import { normalizeTrackerStatus } from "./tracker";

/**
 * Customer shipment and delivery emails. The default policy sends only when the store
 * itself will not: a live Shopify, WooCommerce, or Etsy post-back counts as the store
 * notifying. Manual, CSV, Faire, and a manual post-back do not.
 *
 * The log keeps one row per order (or return) and event. That pair is the idempotency
 * key, so a repeat ship or a repeat tracker webhook does not send a second message.
 */
export const CUSTOMER_MAIL_EVENTS = ["shipped", "out_for_delivery", "delivered", "delivery_exception", "return_label"] as const;
export type CustomerMailEvent = (typeof CUSTOMER_MAIL_EVENTS)[number];

export const CUSTOMER_MAIL_POLICIES = ["store", "always", "never"] as const;
export type CustomerMailPolicy = (typeof CUSTOMER_MAIL_POLICIES)[number];

/** `store` is "only when the store doesn't notify". */
export const DEFAULT_CUSTOMER_MAIL_POLICY: CustomerMailPolicy = "store";

export const CUSTOMER_MAIL_EVENT_LABELS: Record<CustomerMailEvent, string> = {
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_exception: "Delivery exception",
  return_label: "Return label ready",
};

export const SKIP_NO_EMAIL = "The customer has no email address.";
export const SKIP_STORE = "The store notifies the customer.";
export const SKIP_OFF = "This notification is turned off.";
export const SKIP_NO_LABEL = "This return has no label to send.";

export type CustomerMailSettings = {
  shipped: CustomerMailPolicy;
  outForDelivery: CustomerMailPolicy;
  delivered: CustomerMailPolicy;
  deliveryException: CustomerMailPolicy;
  returnLabel: CustomerMailPolicy;
  replyTo: string | null;
  senderName: string | null;
};

export const DEFAULT_CUSTOMER_MAIL_SETTINGS: CustomerMailSettings = {
  shipped: DEFAULT_CUSTOMER_MAIL_POLICY,
  outForDelivery: DEFAULT_CUSTOMER_MAIL_POLICY,
  delivered: DEFAULT_CUSTOMER_MAIL_POLICY,
  deliveryException: DEFAULT_CUSTOMER_MAIL_POLICY,
  returnLabel: DEFAULT_CUSTOMER_MAIL_POLICY,
  replyTo: null,
  senderName: null,
};

export function isCustomerMailEvent(value: string): value is CustomerMailEvent {
  return (CUSTOMER_MAIL_EVENTS as readonly string[]).includes(value);
}

export function policyFor(settings: CustomerMailSettings, event: CustomerMailEvent): CustomerMailPolicy {
  switch (event) {
    case "shipped":
      return settings.shipped;
    case "out_for_delivery":
      return settings.outForDelivery;
    case "delivered":
      return settings.delivered;
    case "delivery_exception":
      return settings.deliveryException;
    case "return_label":
      return settings.returnLabel;
  }
}

export function asCustomerMailPolicy(value: string | null | undefined): CustomerMailPolicy {
  return value === "always" || value === "never" ? value : "store";
}

export function parseNotifyPolicy(value: unknown): CustomerMailPolicy {
  if (value === "store" || value === "always" || value === "never") return value;
  throw new Error("Choose only when the store doesn't notify, always, or never.");
}

export function parseReplyTo(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Reply-to must be an email address.");
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!isEmailAddress(trimmed)) throw new Error("Reply-to must be an email address.");
  return trimmed;
}

export function parseSenderName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Sender name must be text.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > 80 || /[<>\r\n]/.test(name)) {
    throw new Error("Sender name must be 80 characters or fewer, without < or >.");
  }
  return name;
}

/**
 * Live Shopify, WooCommerce, and Etsy post-backs tell the customer themselves.
 * Manual, CSV, Faire, crowdfunding, and a manual post-back do not.
 */
export function storeNotifiesCustomer(input: {
  source: string;
  shopifyMode?: string | null;
  postBack?: "live" | "demo" | "manual" | "not_connected" | null;
  channelSyncStatus?: string | null;
}): boolean {
  if (input.channelSyncStatus === "manual") return false;
  if (input.source === "shopify") return input.shopifyMode === "live";
  if (input.source === "woocommerce" || input.source === "etsy") return input.postBack === "live";
  return false;
}

export type CustomerMailDecision = { send: true } | { send: false; reason: string };

export function customerMailDecision(policy: CustomerMailPolicy, storeNotifies: boolean): CustomerMailDecision {
  if (policy === "never") return { send: false, reason: SKIP_OFF };
  if (policy === "always") return { send: true };
  if (storeNotifies) return { send: false, reason: SKIP_STORE };
  return { send: true };
}

/** One row per order and event, or per return and the return-label event. */
export function customerMailIdempotencyKey(input: { orderId?: string | null; rmaId?: string | null; event: CustomerMailEvent }): string {
  if (input.event === "return_label") return `rma:${input.rmaId ?? ""}:${input.event}`;
  return `order:${input.orderId ?? ""}:${input.event}`;
}

/** The tracker status that should email the customer, or null for a scan that is only "in transit". */
export function customerMailEventForTracker(raw: string | null | undefined): "out_for_delivery" | "delivered" | "delivery_exception" | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "out_for_delivery" || value === "outfordelivery") return "out_for_delivery";
  const normalized = normalizeTrackerStatus(raw);
  if (normalized === "delivered") return "delivered";
  if (normalized === "exception") return "delivery_exception";
  return null;
}

/** Display name in front of MAIL_FROM. The address itself stays MAIL_FROM. */
export function customerMailFrom(mailFrom: string, senderName: string | null | undefined): string {
  const trimmed = mailFrom.trim();
  const name = senderName?.trim();
  if (!name) return trimmed;
  const wrapped = trimmed.match(/<([^>]+)>/);
  const address = (wrapped?.[1] ?? trimmed).trim();
  return `${name} <${address}>`;
}

export function formatEstimatedDelivery(at: number | null | undefined): string | null {
  if (at == null || !Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(at));
}

export type CustomerMailItem = { name: string; qty: number };
export type CustomerMailParcel = { carrier: string | null; service: string | null; trackingNumber: string | null };

export type CustomerMailModel = {
  event: CustomerMailEvent;
  shopName: string;
  brandColor: string | null;
  logoUrl: string | null;
  orderNumber: string | null;
  parcels: CustomerMailParcel[];
  trackingUrl: string | null;
  items: CustomerMailItem[];
  estimatedDelivery: string | null;
};

export type RenderedCustomerMail = { subject: string; html: string; text: string };

const DEFAULT_INK = "#111827";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shopLabel(model: CustomerMailModel): string {
  return model.shopName.trim() || "Your shop";
}

function orderLabel(model: CustomerMailModel): string {
  const number = model.orderNumber?.trim();
  return number ? `order ${number}` : "your order";
}

export function customerMailSubject(model: CustomerMailModel): string {
  const which = orderLabel(model);
  switch (model.event) {
    case "shipped":
      return `Your ${which} has shipped`;
    case "out_for_delivery":
      return `Your ${which} is out for delivery`;
    case "delivered":
      return `Your ${which} was delivered`;
    case "delivery_exception":
      return `A delivery problem with ${which}`;
    case "return_label":
      return `Your return label from ${shopLabel(model)}`;
  }
}

function intro(model: CustomerMailModel): string {
  const shop = shopLabel(model);
  const which = orderLabel(model);
  switch (model.event) {
    case "shipped":
      return `${shop} shipped ${which}.`;
    case "out_for_delivery":
      return `${shop} let us know ${which} is out for delivery.`;
    case "delivered":
      return `${shop} let us know ${which} was delivered.`;
    case "delivery_exception":
      return `The carrier reported a problem delivering ${which} from ${shop}.`;
    case "return_label":
      return `Your return label from ${shop} is ready. Print it and send the items back.`;
  }
}

function linkLabel(event: CustomerMailEvent): string {
  return event === "return_label" ? "Print your return label" : "Track your order";
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function renderCustomerMail(model: CustomerMailModel): RenderedCustomerMail {
  const subject = customerMailSubject(model);
  const shop = shopLabel(model);
  const lead = intro(model);
  const color = model.brandColor && /^#[0-9a-f]{6}$/i.test(model.brandColor) ? model.brandColor : DEFAULT_INK;
  const logo = model.logoUrl?.startsWith("https://") ? model.logoUrl : null;
  const page = httpsUrl(model.trackingUrl);
  const parcels = model.parcels.filter((row) => row.carrier || row.service || row.trackingNumber);
  const items = model.items.filter((row) => row.name.trim() && row.qty > 0);

  const textLines = [lead, "", shop];
  if (model.estimatedDelivery) textLines.push("", `Estimated delivery: ${model.estimatedDelivery}`);
  for (const parcel of parcels) {
    textLines.push("");
    if (parcel.carrier) textLines.push(`Carrier: ${parcel.carrier}`);
    if (parcel.service) textLines.push(`Service: ${parcel.service}`);
    if (parcel.trackingNumber) textLines.push(`Tracking number: ${parcel.trackingNumber}`);
  }
  if (page) textLines.push("", `${linkLabel(model.event)}:`, page);
  if (items.length) {
    textLines.push("", "Items");
    for (const item of items) textLines.push(`- ${item.name.trim()} × ${item.qty}`);
  }

  const parcelHtml = parcels
    .map((parcel) => {
      const lines = [
        parcel.carrier ? `<div>Carrier: ${escapeHtml(parcel.carrier)}</div>` : "",
        parcel.service ? `<div>Service: ${escapeHtml(parcel.service)}</div>` : "",
        parcel.trackingNumber ? `<div>Tracking number: ${escapeHtml(parcel.trackingNumber)}</div>` : "",
      ].filter(Boolean);
      return lines.length ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#111827;">${lines.join("")}</p>` : "";
    })
    .join("");
  const itemsHtml = items.length
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#111827;">Items<br>${items
        .map((item) => `${escapeHtml(item.name.trim())} × ${item.qty}`)
        .join("<br>")}</p>`
    : "";
  const deliveryHtml = model.estimatedDelivery
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#111827;">Estimated delivery: ${escapeHtml(model.estimatedDelivery)}</p>`
    : "";
  const buttonHtml = page
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(page)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">${escapeHtml(linkLabel(model.event))}</a></p>`
    : "";
  const logoHtml = logo
    ? `<img src="${escapeHtml(logo)}" alt="" width="120" style="display:block;max-width:120px;height:auto;margin:0 0 8px;border:0;" />`
    : "";

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${color};padding:20px 24px;color:#ffffff;font-family:Georgia,serif;font-size:18px;">${logoHtml}${escapeHtml(shop)}</td></tr>
<tr><td style="padding:24px;font-family:Georgia,serif;color:#111827;">
<p style="margin:0;font-size:16px;line-height:1.5;">${escapeHtml(lead)}</p>
${deliveryHtml}${parcelHtml}${buttonHtml}${itemsHtml}
</td></tr>
</table>
</td></tr></table></body></html>`;

  return { subject, html, text: textLines.join("\n") };
}

/** A branded sample for the settings preview and "Send a test to me". Not a real order. */
export function sampleCustomerMail(input: {
  event: CustomerMailEvent;
  shopName: string;
  brandColor: string | null;
  logoUrl: string | null;
  trackingUrl: string;
}): CustomerMailModel {
  return {
    event: input.event,
    shopName: input.shopName,
    brandColor: input.brandColor,
    logoUrl: input.logoUrl,
    orderNumber: "1001",
    parcels: [{ carrier: "USPS", service: "USPS Ground Advantage", trackingNumber: "9400111899223197428490" }],
    trackingUrl: input.trackingUrl,
    items: [{ name: "Desk lamp", qty: 1 }],
    estimatedDelivery: "Oct 8, 2026",
  };
}
