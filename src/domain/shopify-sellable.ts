export type SellableInput = {
  onHand: number;
  held: number;
  remainingToPick: number;
};

export type SellableBreakdown = SellableInput & {
  available: number;
  sellable: number;
};

export const OPEN_PICK_STATUSES = ["draft", "open", "picking"] as const;

export function isOpenPickStatus(status: string): boolean {
  return (OPEN_PICK_STATUSES as readonly string[]).includes(status);
}

export function remainingToPickQty(qty: number, qtyPicked: number): number {
  return Math.max(0, qty - Math.max(0, qtyPicked));
}

export function computeSellable(input: SellableInput): SellableBreakdown {
  const onHand = Math.max(0, input.onHand);
  const held = Math.min(onHand, Math.max(0, input.held));
  const available = Math.max(0, onHand - held);
  const remainingToPick = Math.max(0, input.remainingToPick);
  return {
    onHand,
    held,
    remainingToPick,
    available,
    sellable: Math.max(0, available - remainingToPick),
  };
}

export function demoInventoryItemGid(sku: string): string {
  const token = sku.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() || "SKU";
  return `gid://shopify/InventoryItem/demo-${token}`;
}

export function demoShopifyLocationGid(): string {
  return "gid://shopify/Location/demo-main";
}

export function sellableSyncName(): "available" {
  return "available";
}
