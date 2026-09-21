import type { TrafficFlightStatus } from "./traffic";

export const TRACKER_STATUSES = ["pre_transit", "in_transit", "delivered", "exception"] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

const RANK: Record<TrackerStatus, number> = {
  exception: -1,
  pre_transit: 0,
  in_transit: 1,
  delivered: 2,
};

const PRE_TRANSIT = new Set([
  "pre_transit",
  "unknown",
  "label_created",
  "pretransit",
  "ny",
  "ac",
  "un",
  "info_received",
  "pending",
]);

const IN_TRANSIT = new Set([
  "in_transit",
  "intransit",
  "out_for_delivery",
  "outfordelivery",
  "it",
  "at",
  "of",
]);

const DELIVERED = new Set(["delivered", "available_for_pickup", "availableforpickup", "de"]);

const EXCEPTION = new Set([
  "failure",
  "error",
  "cancelled",
  "canceled",
  "return_to_sender",
  "returntosender",
  "returned",
  "undeliverable",
  "expired",
  "exception",
  "ex",
]);

export type ParsedTrackerWebhook = {
  provider: "easypost" | "shipengine" | "demo";
  trackingNumber: string;
  status: string;
  eventId: string | null;
};

export function normalizeTrackerStatus(raw: string | null | undefined): TrackerStatus | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (EXCEPTION.has(value)) return "exception";
  if (DELIVERED.has(value)) return "delivered";
  if (IN_TRANSIT.has(value)) return "in_transit";
  if (PRE_TRANSIT.has(value)) return "pre_transit";
  return null;
}

export function trackerToFlight(
  status: TrackerStatus,
): Exclude<TrafficFlightStatus, "unmapped" | "arrived_estimate"> {
  if (status === "exception") return "exception";
  if (status === "delivered") return "arrived";
  if (status === "in_transit") return "in_flight";
  return "at_gate";
}

export function laggingTrackerStatus(statuses: (string | null | undefined)[]): TrackerStatus | null {
  const mapped = statuses.map((row) => normalizeTrackerStatus(row)).filter((row): row is TrackerStatus => Boolean(row));
  if (mapped.length === 0) return null;
  return mapped.reduce((min, row) => (RANK[row] < RANK[min] ? row : min));
}

export function rollupOrderTracker(packages: { trackerStatus: string | null }[]): string | null {
  if (packages.length === 0) return null;
  const mapped = packages.map((row) => normalizeTrackerStatus(row.trackerStatus));
  if (mapped.some((status) => status === "exception")) return "exception";
  if (mapped.some((status) => !status)) return null;
  return laggingTrackerStatus(packages.map((row) => row.trackerStatus));
}

export type RelabelDecision =
  | { ok: true }
  | { ok: false; error: string; code: "NOT_EXCEPTION" | "NO_LABEL" | "CANCELLED" };

export function canRelabelException(input: {
  status: string;
  trackerStatus?: string | null;
  labelStatus?: string | null;
  trackingNumber?: string | null;
}): RelabelDecision {
  if (input.status === "cancelled") {
    return { ok: false, error: "Cancelled orders cannot relabel", code: "CANCELLED" };
  }
  if (normalizeTrackerStatus(input.trackerStatus) !== "exception") {
    return { ok: false, error: "Relabel is for tracker exceptions", code: "NOT_EXCEPTION" };
  }
  if (input.labelStatus !== "purchased" && !input.trackingNumber?.trim()) {
    return { ok: false, error: "Buy a label before relabeling", code: "NO_LABEL" };
  }
  return { ok: true };
}

export function parseTrackerWebhook(payload: unknown): ParsedTrackerWebhook | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const easy = parseEasyPost(record);
  if (easy) return easy;
  const engine = parseShipEngine(record);
  if (engine) return engine;

  const trackingNumber =
    stringField(record.trackingNumber) ||
    stringField(record.tracking_number) ||
    stringField(record.tracking_code);
  const status = stringField(record.status) || stringField(record.status_code) || stringField(record.statusCode);
  if (!trackingNumber || !status) return null;
  return {
    provider: "demo",
    trackingNumber,
    status,
    eventId: stringField(record.eventId) || stringField(record.id) || null,
  };
}

function parseEasyPost(record: Record<string, unknown>): ParsedTrackerWebhook | null {
  const result =
    asRecord(record.result) ??
    asRecord(record.tracker) ??
    (record.object === "Tracker" ? record : null);
  if (!result) return null;
  const trackingNumber = stringField(result.tracking_code) || stringField(result.tracking_number);
  const status = stringField(result.status);
  if (!trackingNumber || !status) return null;
  return {
    provider: "easypost",
    trackingNumber,
    status,
    eventId: stringField(record.id) || stringField(result.id) || null,
  };
}

function parseShipEngine(record: Record<string, unknown>): ParsedTrackerWebhook | null {
  const data = asRecord(record.data) ?? (record.resource_type ? record : null);
  if (!data) return null;
  const trackingNumber = stringField(data.tracking_number) || stringField(record.tracking_number);
  const status = stringField(data.status_code) || stringField(data.status_description) || stringField(data.status);
  if (!trackingNumber || !status) return null;
  return {
    provider: "shipengine",
    trackingNumber,
    status,
    eventId: stringField(record.resource_url) || stringField(data.tracking_number) || null,
  };
}

export async function trackerHmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function trackerHmacBase64(secret: string, body: string): Promise<string> {
  const hex = await trackerHmacHex(secret, body);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyTrackerHmac(secret: string, body: string, header: string | undefined): Promise<boolean> {
  if (!header) return false;
  const actual = header.replace(/^(hmac-sha256-hex=|sha256=|hmac-sha256=)/i, "").trim();
  const expectedHex = await trackerHmacHex(secret, body);
  const expectedB64 = await trackerHmacBase64(secret, body);
  return timingEqual(actual.toLowerCase(), expectedHex.toLowerCase()) || timingEqual(actual, expectedB64);
}

function timingEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
