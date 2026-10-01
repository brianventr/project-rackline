import { balanceKey } from "./inventory";
import type { StockedBay } from "./partial-pick";

export class ClientStockError extends Error {
  constructor(
    /** The 3PL client short of stock, or null when an own-stock pick reached into client stock. */
    public clientId: string | null,
    public itemId: string,
    public onHand: number,
    public needed: number,
  ) {
    super(
      clientId
        ? `Client stock insufficient: have ${onHand}, need ${needed}`
        : `Own stock insufficient: have ${onHand}, need ${needed}; the rest belongs to 3PL clients`,
    );
    this.name = "ClientStockError";
  }
}

export function clientBalanceKey(locationId: string, itemId: string, clientId: string): string {
  return `${locationId}:${itemId}:${clientId}`;
}

export function applyClientReceive(
  balances: Map<string, number>,
  input: { locationId: string; itemId: string; clientId: string; qty: number },
): Map<string, number> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const next = new Map(balances);
  const key = clientBalanceKey(input.locationId, input.itemId, input.clientId);
  next.set(key, (next.get(key) ?? 0) + input.qty);
  return next;
}

export function applyClientOutbound(
  balances: Map<string, number>,
  input: { locationId: string; itemId: string; clientId: string; qty: number },
): Map<string, number> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const next = new Map(balances);
  const key = clientBalanceKey(input.locationId, input.itemId, input.clientId);
  const current = next.get(key) ?? 0;
  if (current < input.qty) {
    throw new ClientStockError(input.clientId, input.itemId, current, input.qty);
  }
  const left = current - input.qty;
  if (left === 0) next.delete(key);
  else next.set(key, left);
  return next;
}

/** Movements that put units back into a client's balance: receipts, and unpicks of that client's order. */
export function isClientInboundMovement(type: string): boolean {
  return type === "receive" || type === "unpick";
}

export function isClientOutboundMovement(type: string): boolean {
  return type === "pick" || type === "ship" || type === "rtv" || type === "scrap" || type === "unreceive";
}

/** Who owns stock: a 3PL client's id, or null for the warehouse's own stock. */
export type StockOwner = string | null;

export type BayReservation = { orderId: string; clientId: StockOwner; qty: number };

/** One item at one bay, with what is held, who owns it, and which orders have reserved it. */
export type BayStock = Omit<StockedBay, "qty"> & {
  itemId: string;
  /** Physical units at the bay. */
  onHand: number;
  /** Units not under a hold. */
  available: number;
  /** Units each 3PL client owns here, by client id. Own stock is whatever no client owns. */
  clientQty: Map<string, number>;
  reservations: BayReservation[];
};

/** Units the owner has at the bay, held or reserved or not. */
export function ownerOnHand(bay: Pick<BayStock, "onHand" | "clientQty">, owner: StockOwner): number {
  if (owner) return Math.max(0, bay.clientQty.get(owner) ?? 0);
  let clientUnits = 0;
  for (const qty of bay.clientQty.values()) clientUnits += Math.max(0, qty);
  return Math.max(0, bay.onHand - clientUnits);
}

/** Units free of holds and of every other order's reservation, whoever owns them. */
export function freeQty(bay: BayStock, excludeOrderId?: string): number {
  let reserved = 0;
  for (const row of bay.reservations) {
    if (excludeOrderId && row.orderId === excludeOrderId) continue;
    reserved += Math.max(0, row.qty);
  }
  return Math.max(0, bay.available - reserved);
}

/**
 * Units an order may plan to pick from the bay: free of holds and other orders' reservations, and
 * owned by the order's owner after that owner's other orders have reserved theirs. A 3PL client's
 * order only takes that client's stock, and an own-stock order never takes a client's.
 */
export function plannableQty(bay: BayStock, owner: StockOwner, excludeOrderId?: string): number {
  let reservedByOwner = 0;
  for (const row of bay.reservations) {
    if (excludeOrderId && row.orderId === excludeOrderId) continue;
    if ((row.clientId ?? null) === owner) reservedByOwner += Math.max(0, row.qty);
  }
  return Math.max(0, Math.min(freeQty(bay, excludeOrderId), ownerOnHand(bay, owner) - reservedByOwner));
}

/** The bays per item an order can pick from, each cut to what that order's owner may plan there. */
export function ownerBaysByItem(
  stock: BayStock[],
  options: { owner: StockOwner; excludeOrderId?: string },
): Map<string, StockedBay[]> {
  const byItem = new Map<string, StockedBay[]>();
  for (const bay of stock) {
    const list = byItem.get(bay.itemId) ?? [];
    list.push({
      locationId: bay.locationId,
      locationCode: bay.locationCode,
      locationName: bay.locationName,
      barcode: bay.barcode,
      qty: plannableQty(bay, options.owner, options.excludeOrderId),
      type: bay.type,
      slotRole: bay.slotRole,
      zoneId: bay.zoneId,
    });
    byItem.set(bay.itemId, list);
  }
  return byItem;
}

/**
 * Own-stock picks (no client on the movement) may only take units no 3PL client owns. `onHand` and
 * `clientUnits` are keyed like inventory balances and read before the plan; client picks leave own
 * stock alone, so only own picks count down.
 */
export function assertOwnStockPicks(
  movements: { type: string; itemId: string; qty: number; fromLocationId?: string | null; clientId?: string | null }[],
  onHand: Map<string, number>,
  clientUnits: Map<string, number>,
): void {
  const own = new Map<string, number>();
  for (const movement of movements) {
    if (movement.type !== "pick" || movement.clientId || !movement.fromLocationId || movement.qty <= 0) continue;
    const key = balanceKey(movement.fromLocationId, movement.itemId);
    const left = own.get(key) ?? Math.max(0, (onHand.get(key) ?? 0) - (clientUnits.get(key) ?? 0));
    if (movement.qty > left) throw new ClientStockError(null, movement.itemId, left, movement.qty);
    own.set(key, left - movement.qty);
  }
}
