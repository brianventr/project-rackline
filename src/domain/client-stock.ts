export class ClientStockError extends Error {
  constructor(
    public clientId: string,
    public itemId: string,
    public onHand: number,
    public needed: number,
  ) {
    super(`Client stock insufficient: have ${onHand}, need ${needed}`);
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

export function isClientInboundMovement(type: string): boolean {
  return type === "receive";
}

export function isClientOutboundMovement(type: string): boolean {
  return type === "pick" || type === "ship" || type === "rtv" || type === "scrap" || type === "unreceive";
}
