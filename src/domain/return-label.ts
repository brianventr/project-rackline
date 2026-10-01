import { isLivePostage } from "./carrier-live";
import { resolveService } from "./carriers";
import { normalizeTrackerStatus, type TrackerStatus } from "./tracker";
import { safeLink, trackerHistory, trackerStatusLabel, type TrackerReceipt, type TrackingEvent } from "./tracking-page";

export type ReturnLabelStatus = "active" | "voided";

/** Where a customer return is addressed: the building's return address, else the address it ships from. */
export function returnDestination(warehouse: {
  returnAddress?: string | null;
  shipFromAddress?: string | null;
} | null): string | null {
  return warehouse?.returnAddress?.trim() || warehouse?.shipFromAddress?.trim() || null;
}

/** Live carriers whose label API buys a return and hands back a link to print it. */
const LIVE_RETURN_PROVIDERS = new Set(["easypost", "shipengine", "fedex"]);

const PROVIDER_NAMES: Record<string, string> = { ups: "UPS", usps: "USPS", dhl: "DHL" };

/** Why this carrier account cannot buy a return label, or null when it can. Demo accounts always can. */
export function returnLabelRefusal(connection: { provider: string; mode: string } | null | undefined): string | null {
  if (!connection || !isLivePostage(connection.provider, connection.mode)) return null;
  if (LIVE_RETURN_PROVIDERS.has(connection.provider)) return null;
  const name = PROVIDER_NAMES[connection.provider] ?? connection.provider;
  return `A direct ${name} account cannot buy return labels in Rackline yet. Choose a service on EasyPost, ShipEngine, or FedEx.`;
}

/** Why this RMA cannot take a new return label, or null when it can. */
export function returnLabelBlock(input: { rmaStatus: string; hasActiveLabel: boolean }): string | null {
  if (input.rmaStatus === "received") return "This return is already received. It does not need a label.";
  if (input.hasActiveLabel) return "This return already has a label. Void it before buying another.";
  return null;
}

/** Why this return label cannot be voided, or null when it can. Once the carrier scans it, it is spent. */
export function returnLabelVoidBlock(input: { status: string; trackerStatus: string | null }): string | null {
  if (input.status === "voided") return "This return label is already voided.";
  const status = normalizeTrackerStatus(input.trackerStatus);
  if (status && status !== "pre_transit") {
    return "The carrier has already scanned this label. It can no longer be voided.";
  }
  return null;
}

/** The owner's one-word read on a return label. Tracker wording only once the carrier has sent an update. */
export function returnLabelStatusLabel(input: { status: string; trackerStatus: string | null }): string {
  if (input.status === "voided") return "Voided";
  const status = normalizeTrackerStatus(input.trackerStatus);
  if (!status || status === "pre_transit") return "Label ready";
  return trackerStatusLabel(input.trackerStatus) ?? "Label ready";
}

export type PublicReturnLabelView = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  rmaNumber: string;
  status: ReturnLabelStatus;
  statusLabel: string;
  trackerStatus: TrackerStatus | null;
  /** Null once voided, so a cancelled label shows no addresses or links. */
  label: {
    carrier: string;
    service: string;
    trackingNumber: string;
    trackingUrl: string | null;
    labelUrl: string | null;
    from: { name: string; address: string };
    to: { name: string; address: string };
  } | null;
  /** Newest first. */
  events: TrackingEvent[];
  items: { name: string; qty: number }[];
  createdAt: number;
};

export type ReturnLabelPageInput = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  rmaNumber: string;
  label: {
    status: string;
    carrierCompany: string;
    carrierService: string;
    trackingNumber: string;
    trackingUrl: string | null;
    labelUrl: string | null;
    trackerStatus: string | null;
    fromName: string;
    fromAddress: string;
    toName: string;
    toAddress: string;
    createdAt: number;
  };
  items: { name: string; qty: number }[];
  receipts: TrackerReceipt[];
};

/**
 * What the customer's return label page shows. Built field by field so nothing internal (costs,
 * carrier ids, notes, who bought it) reaches the page. The addresses are the two printed on the label.
 */
export function publicReturnLabelView(input: ReturnLabelPageInput): PublicReturnLabelView {
  const { label } = input;
  const status: ReturnLabelStatus = label.status === "voided" ? "voided" : "active";
  const trackerStatus = normalizeTrackerStatus(label.trackerStatus);
  const history = status === "active" ? trackerHistory(input.receipts).events : [];
  const events = history.some((event) => event.status === "pre_transit")
    ? history
    : [...history, { at: label.createdAt, status: "pre_transit" as const, label: "Label created", message: null, place: null }];
  return {
    shop: { name: input.shop.name, brandColor: input.shop.brandColor, logoUrl: input.shop.logoUrl },
    rmaNumber: input.rmaNumber,
    status,
    statusLabel: customerStatusLabel(status, label.trackerStatus),
    trackerStatus: status === "active" ? trackerStatus : null,
    label:
      status === "active"
        ? {
            carrier: label.carrierCompany,
            service: resolveService(label.carrierService)?.service ?? label.carrierService,
            trackingNumber: label.trackingNumber,
            trackingUrl: safeLink(label.trackingUrl),
            labelUrl: safeLink(label.labelUrl),
            from: { name: label.fromName, address: label.fromAddress },
            to: { name: label.toName, address: label.toAddress },
          }
        : null,
    events: status === "active" ? events : [],
    items: input.items.map((item) => ({ name: item.name, qty: item.qty })),
    createdAt: label.createdAt,
  };
}

function customerStatusLabel(status: ReturnLabelStatus, trackerStatus: string | null): string {
  if (status === "voided") return "Cancelled";
  const normalized = normalizeTrackerStatus(trackerStatus);
  if (!normalized || normalized === "pre_transit") return "Ready to send";
  const label = trackerStatusLabel(trackerStatus);
  if (label === "In transit") return "On its way back";
  return label ?? "Ready to send";
}
