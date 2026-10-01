import { normalizeTrackerStatus, parseTrackerWebhook } from "../tracker";
import { BOTH_MODES, DAY_MS, exceptionItem, plural, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Parcels the carrier's tracker says went wrong, or that stopped moving. */
export const TRACKER_SOURCE: ExceptionSourceInfo = { id: "tracker", label: "Tracking", modes: BOTH_MODES };

/** A parcel with no tracker update for this long, before delivery, counts as stuck. */
export const STUCK_IN_TRANSIT_DAYS = 5;
/** Tracker news older than this drops off: by then the carrier has delivered, returned, or lost it. */
export const TRACKER_WINDOW_MS = 45 * DAY_MS;

const RETURN_STATUSES = new Set(["return_to_sender", "returntosender", "returned"]);

export type TrackerRow = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  warehouseId: string;
  /** Null for an order shipped without boxes, whose tracker is on the order. */
  packageId: string | null;
  packageNumber: string | null;
  trackingNumber: string | null;
  trackerStatus: string | null;
  trackerUpdatedAt: number | null;
};

/** The carrier's own word from a stored webhook body. Rackline stores only the normalized status. */
export function trackerRawStatus(payloadJson: string | null | undefined): string | null {
  if (!payloadJson) return null;
  try {
    return parseTrackerWebhook(JSON.parse(payloadJson))?.status ?? null;
  } catch {
    return null;
  }
}

export function isReturnToSender(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return RETURN_STATUSES.has(raw.trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

function rawWords(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ");
}

/** `rawStatus` is the carrier's latest word for the tracking number, when a webhook body is kept. */
export function trackerProblem(row: TrackerRow, rawStatus: string | null, now: number): ExceptionItem | null {
  const status = normalizeTrackerStatus(row.trackerStatus);
  const at = row.trackerUpdatedAt;
  const parcel = row.packageNumber ? `${row.packageNumber} on order ${row.orderNumber}` : `Order ${row.orderNumber}`;
  const tracking = row.trackingNumber ? ` (${row.trackingNumber})` : "";
  const base = {
    source: TRACKER_SOURCE.id,
    key: row.packageId ? `package.${row.packageId}` : `order.${row.orderId}`,
    warehouseId: row.warehouseId,
    orderId: row.orderId,
    createdAt: at,
    link: `/outbound/orders/${row.orderId}`,
  };
  if (status === "exception") {
    if (isReturnToSender(rawStatus)) {
      return exceptionItem({
        ...base,
        kind: "return_to_sender",
        kindLabel: "Return to sender",
        severity: "blocking",
        title: `${parcel} is going back to the sender`,
        detail: `The carrier is returning it${tracking}. Check the address with ${row.customerName}, then reship or refund once it is back.`,
      });
    }
    const said = rawStatus ? ` The carrier says: ${rawWords(rawStatus)}.` : "";
    return exceptionItem({
      ...base,
      kind: "delivery_exception",
      kindLabel: "Delivery exception",
      severity: "warning",
      title: `${parcel} hit a delivery problem`,
      detail: `The carrier flagged it${tracking}.${said} Check the tracking, then relabel, reship, or contact ${row.customerName}.`,
    });
  }
  if ((status === "pre_transit" || status === "in_transit") && at != null && now - at >= STUCK_IN_TRANSIT_DAYS * DAY_MS) {
    const days = Math.floor((now - at) / DAY_MS);
    const where = status === "pre_transit" ? "The carrier has not scanned it since the label was made" : "It has not moved";
    return exceptionItem({
      ...base,
      kind: "stuck_in_transit",
      kindLabel: "Stuck in transit",
      severity: "warning",
      title: `${parcel} has had no tracking news for ${plural(days, "day")}`,
      detail: `${where}${tracking}. Ask the carrier to trace it, or reship to ${row.customerName}.`,
    });
  }
  return null;
}

export function trackerProblems(rows: readonly TrackerRow[], rawStatusByTracking: ReadonlyMap<string, string>, now: number): ExceptionItem[] {
  return rows.flatMap((row) => {
    const raw = row.trackingNumber ? (rawStatusByTracking.get(row.trackingNumber) ?? null) : null;
    const item = trackerProblem(row, raw, now);
    return item ? [item] : [];
  });
}
