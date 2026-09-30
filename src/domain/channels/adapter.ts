import type { DestColumns } from "../geo";
import type { OperatingMode } from "../operating-mode";

/**
 * Every sales channel lands orders in the same shape so pick, pack, ship, and tracking post-back
 * work the same no matter where the order came from. Shopify keeps its GraphQL fulfillment-order
 * path; the rest go through `db/channel-ingest.ts`.
 */
export type ChannelId = "shopify" | "woocommerce" | "etsy" | "faire";

export type ChannelOrderLine = {
  sku: string;
  title: string;
  qty: number;
  externalLineId: string | null;
};

export type ChannelOrder = {
  externalId: string;
  externalName: string;
  customerName: string;
  shipToAddress: string | null;
  dest: DestColumns;
  lines: ChannelOrderLine[];
};

export type ChannelSkip = { skip: true; reason: string };

export type ChannelAuth = "oauth" | "api_key" | "csv";

export type ChannelInfo = {
  id: ChannelId;
  name: string;
  auth: ChannelAuth;
  /** Orders arrive on their own (webhook or scheduled pull) once connected. */
  liveOrders: boolean;
  /** Tracking numbers post back to the channel when the order ships. */
  trackingPostBack: boolean;
  csvImport: boolean;
  blurb: string;
};

export const CHANNELS: Record<ChannelId, ChannelInfo> = {
  shopify: {
    id: "shopify",
    name: "Shopify",
    auth: "oauth",
    liveOrders: true,
    trackingPostBack: true,
    csvImport: false,
    blurb: "Checkout becomes a pick ticket; sellable qty and fulfillment post back.",
  },
  woocommerce: {
    id: "woocommerce",
    name: "WooCommerce",
    auth: "api_key",
    liveOrders: true,
    trackingPostBack: true,
    csvImport: false,
    blurb: "Processing orders arrive by webhook; shipping marks them completed with tracking.",
  },
  etsy: {
    id: "etsy",
    name: "Etsy",
    auth: "oauth",
    liveOrders: true,
    trackingPostBack: true,
    csvImport: true,
    blurb: "Paid receipts are pulled every 15 minutes; tracking posts back when you ship.",
  },
  faire: {
    id: "faire",
    name: "Faire",
    auth: "csv",
    liveOrders: false,
    trackingPostBack: false,
    csvImport: true,
    blurb: "Wholesale orders from a Faire export.",
  },
};

export const CHANNEL_IDS = Object.keys(CHANNELS) as ChannelId[];

export function isChannelId(value: string): value is ChannelId {
  return value in CHANNELS;
}

/** Order `source` values that post tracking back through `db/channel-fulfill.ts`. */
export function postsTrackingBack(source: string): source is "woocommerce" | "etsy" {
  return source === "woocommerce" || source === "etsy";
}

export type ChannelConnectionView = {
  status: string;
  mode: string;
  lastSyncAt: number | null;
  lastSyncError: string | null;
};

export type ChannelHealth = "disconnected" | "csv" | "live" | "demo" | "error" | "pending" | "paused";

export function channelHealth(info: ChannelInfo, row: ChannelConnectionView | null): ChannelHealth {
  if (!row || row.status === "disconnected") return "disconnected";
  if (row.status === "paused") return "paused";
  if (row.status === "pending") return "pending";
  if (row.lastSyncError) return "error";
  if (row.mode === "demo") return "demo";
  if (row.mode === "live" && info.liveOrders) return "live";
  return "csv";
}

/**
 * Garage shops lead with storefronts they sell through directly; Manufacturer mode leads with
 * wholesale and keeps storefronts beside EDI and 3PL clients.
 */
export function channelOrder(mode: OperatingMode): ChannelId[] {
  return mode === "garage" ? ["shopify", "etsy", "woocommerce", "faire"] : ["shopify", "faire", "woocommerce", "etsy"];
}

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** Mirrors carrier names Etsy and WooCommerce shipment-tracking plugins recognize. */
export function carrierNameForChannel(company: string | null | undefined): string {
  const value = (company ?? "").toLowerCase();
  if (value.includes("usps")) return "usps";
  if (value.includes("ups")) return "ups";
  if (value.includes("fedex")) return "fedex";
  if (value.includes("dhl")) return "dhl";
  if (value.includes("canada")) return "canada-post";
  return "other";
}
