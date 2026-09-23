export const ORDER_STEPS = ["open", "picking", "picked", "packing", "packed", "shipped"] as const;
export const RECEIPT_STEPS = ["draft", "receiving", "received"] as const;
export const TRANSFER_STEPS = ["draft", "in_progress", "posted"] as const;
export const WORK_ORDER_STEPS = ["draft", "in_progress", "completed"] as const;
export const COUNT_STEPS = ["draft", "counting", "posted"] as const;
export const PURCHASE_STEPS = ["draft", "ordered", "receiving", "received"] as const;
export const RETURN_STEPS = ["open", "receiving", "received"] as const;
export const VENDOR_RETURN_STEPS = ["open", "returning", "returned"] as const;
export const REPLENISH_STEPS = ["draft", "in_progress", "posted"] as const;
export const KIT_STEPS = ["draft", "in_progress", "completed"] as const;
export const HOLD_STEPS = ["open", "released"] as const;
export const EQUIPMENT_ASSIGNMENT_STEPS = ["open", "closed"] as const;
export const WAVE_STEPS = ["draft", "released", "picking", "completed"] as const;
export const ASN_STEPS = ["draft", "expected", "receiving", "received"] as const;
export const YARD_STEPS = ["expected", "checked_in", "at_dock", "checked_out"] as const;

export type OrderStep = (typeof ORDER_STEPS)[number];
export type ReceiptStep = (typeof RECEIPT_STEPS)[number];
export type TransferStep = (typeof TRANSFER_STEPS)[number];
export type WorkOrderStep = (typeof WORK_ORDER_STEPS)[number];
export type CountStep = (typeof COUNT_STEPS)[number];

export function normalizeOrderStatus(status: string): string {
  return status === "draft" ? "open" : status;
}

export function canStartPick(status: string): boolean {
  return normalizeOrderStatus(status) === "open";
}

export function canPickOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "open" || value === "picking";
}

export function canStartPack(status: string): boolean {
  return normalizeOrderStatus(status) === "picked";
}

export function canPackOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "picked" || value === "packing";
}

export function canShipOrder(status: string): boolean {
  return normalizeOrderStatus(status) === "packed";
}

export function canShipCartonOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "packing" || value === "packed";
}

export function canReceive(status: string): boolean {
  return status === "draft" || status === "receiving";
}

export function canStartPurchase(status: string): boolean {
  return status === "draft";
}

export function canReceivePurchase(status: string): boolean {
  return status === "draft" || status === "ordered" || status === "receiving";
}

export function canReceiveReturn(status: string): boolean {
  return status === "open" || status === "receiving";
}

export function canPostVendorReturn(status: string): boolean {
  return status === "open" || status === "returning";
}

export function isOpenPurchase(status: string): boolean {
  return canReceivePurchase(status);
}

export function isOpenReturn(status: string): boolean {
  return canReceiveReturn(status);
}

export function canPostTransfer(status: string): boolean {
  return status === "draft" || status === "in_progress";
}

export function canCompleteWorkOrder(status: string): boolean {
  return status === "draft" || status === "in_progress";
}

export function canPostCount(status: string): boolean {
  return status === "draft" || status === "counting";
}

export function canPostReplenishment(status: string): boolean {
  return status === "draft" || status === "in_progress";
}

export function canCompleteKit(status: string): boolean {
  return status === "draft" || status === "in_progress";
}

export function canDekit(status: string): boolean {
  return status === "completed";
}

export function canReleaseHold(status: string): boolean {
  return status === "open";
}

export function isOpenOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value !== "shipped" && value !== "cancelled";
}

export function canCancelOrder(status: string): boolean {
  return isOpenOrder(status);
}

export function canUnpickOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "picking" || value === "picked" || value === "packing" || value === "packed";
}

export function isOpenReceipt(status: string): boolean {
  return canReceive(status);
}

export function isOpenTransfer(status: string): boolean {
  return canPostTransfer(status);
}

export function isOpenWorkOrder(status: string): boolean {
  return canCompleteWorkOrder(status);
}

export function isOpenCount(status: string): boolean {
  return canPostCount(status);
}

export function isOpenReplenishment(status: string): boolean {
  return canPostReplenishment(status);
}

export function isOpenKit(status: string): boolean {
  return canCompleteKit(status);
}

export function isOpenVendorReturn(status: string): boolean {
  return canPostVendorReturn(status);
}

export function isOpenHoldStatus(status: string): boolean {
  return canReleaseHold(status);
}

export function canCheckInEquipment(status: string): boolean {
  return status === "open";
}

export function canReturnEquipmentToService(status: string): boolean {
  return status === "out_of_service";
}

export function canReleaseWave(status: string): boolean {
  return status === "draft";
}

export function canPickWave(status: string): boolean {
  return status === "released" || status === "picking";
}

export function canCompleteWave(status: string): boolean {
  return status === "released" || status === "picking";
}

export function isOpenWave(status: string): boolean {
  return status === "draft" || status === "released" || status === "picking";
}

export function canExpectAsn(status: string): boolean {
  return status === "draft";
}

export function canReceiveAsn(status: string): boolean {
  return status === "draft" || status === "expected" || status === "receiving";
}

export function isOpenAsn(status: string): boolean {
  return canReceiveAsn(status);
}

export function canCheckInYard(status: string): boolean {
  return status === "expected";
}

export function canAssignDock(status: string): boolean {
  return status === "checked_in" || status === "at_dock";
}

export function canCheckOutYard(status: string): boolean {
  return status === "checked_in" || status === "at_dock";
}

export function isOpenYard(status: string): boolean {
  return status === "expected" || status === "checked_in" || status === "at_dock";
}

/** Sentence case for display: "In progress", "Checked in", "Order now". */
export function statusText(status: string): string {
  const label = statusLabel(status);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function statusLabel(status: string): string {
  if (status === "in_progress") return "In progress";
  if (status === "checked_in") return "Checked in";
  if (status === "at_dock") return "At dock";
  if (status === "checked_out") return "Checked out";
  return status.replaceAll("_", " ");
}

export const STATUS_TONES = ["neutral", "info", "progress", "success", "warning", "danger"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

const TONE_BY_STATUS: Record<string, StatusTone> = {
  draft: "neutral",
  none: "neutral",
  closed: "neutral",
  idle: "neutral",
  skipped: "neutral",
  dekitted: "neutral",
  voided: "neutral",
  inbound: "neutral",
  checked_out: "neutral",
  clear: "neutral",
  open: "info",
  expected: "info",
  ordered: "info",
  suggested: "info",
  sent: "info",
  released: "info",
  connected: "info",
  default: "info",
  demo: "info",
  available: "info",
  active: "info",
  at_gate: "info",
  pre_transit: "info",
  picking: "progress",
  picked: "progress",
  packing: "progress",
  packed: "progress",
  receiving: "progress",
  counting: "progress",
  in_progress: "progress",
  returning: "progress",
  checked_in: "progress",
  at_dock: "progress",
  dock: "progress",
  claimed: "progress",
  working: "progress",
  purchased: "progress",
  in_transit: "progress",
  in_flight: "progress",
  shipped: "success",
  received: "success",
  completed: "success",
  posted: "success",
  returned: "success",
  delivered: "success",
  arrived: "success",
  arrived_estimate: "success",
  synced: "success",
  ok: "success",
  done: "success",
  fulfilled: "success",
  paid: "success",
  healthy: "success",
  covered: "success",
  on_hand: "success",
  variance: "warning",
  exception: "warning",
  expiring: "warning",
  order_now: "warning",
  runway: "warning",
  cancelled: "danger",
  failed: "danger",
  failure: "danger",
  error: "danger",
  expired: "danger",
  out: "danger",
  out_of_service: "danger",
  return_to_sender: "danger",
};

/** Colour family for a document, label, tracker, or sync status. Unknown values stay neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  const key = status.trim().toLowerCase().replaceAll(" ", "_");
  return TONE_BY_STATUS[key] ?? "neutral";
}
