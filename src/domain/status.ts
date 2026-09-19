export const ORDER_STEPS = ["open", "picking", "picked", "packing", "packed", "shipped"] as const;
export const RECEIPT_STEPS = ["draft", "receiving", "received"] as const;
export const TRANSFER_STEPS = ["draft", "in_progress", "posted"] as const;
export const WORK_ORDER_STEPS = ["draft", "in_progress", "completed"] as const;
export const COUNT_STEPS = ["draft", "counting", "posted"] as const;
export const PURCHASE_STEPS = ["draft", "ordered", "receiving", "received"] as const;
export const RETURN_STEPS = ["open", "receiving", "received"] as const;
export const REPLENISH_STEPS = ["draft", "in_progress", "posted"] as const;
export const KIT_STEPS = ["draft", "completed"] as const;
export const HOLD_STEPS = ["open", "released"] as const;

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
  return status === "draft";
}

export function canReleaseHold(status: string): boolean {
  return status === "open";
}

export function isOpenOrder(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value !== "shipped" && value !== "cancelled";
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

export function isOpenHoldStatus(status: string): boolean {
  return canReleaseHold(status);
}

export function statusLabel(status: string): string {
  if (status === "in_progress") return "In progress";
  return status.replaceAll("_", " ");
}
