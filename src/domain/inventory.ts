export type MovementType =
  | "receive"
  | "move"
  | "pick"
  | "ship"
  | "adjust"
  | "wo_consume"
  | "wo_produce"
  | "kit_consume"
  | "kit_produce"
  | "scrap"
  | "rtv"
  | "unpick"
  | "unreceive";

export type MovementDraft = {
  type: MovementType;
  itemId: string;
  qty: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  refType: string;
  refId: string;
  reason?: string | null;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
  clientId?: string | null;
};

export type StockPlan = {
  balances: Map<string, number>;
  movements: MovementDraft[];
};

export class InsufficientStockError extends Error {
  constructor(
    public sku: string,
    public onHand: number,
    public needed: number,
  ) {
    super(`Insufficient stock for ${sku}: have ${onHand}, need ${needed}`);
    this.name = "InsufficientStockError";
  }
}

export function balanceKey(locationId: string, itemId: string): string {
  return `${locationId}:${itemId}`;
}

export function parseBalanceKey(key: string): { locationId: string; itemId: string } {
  const splitAt = key.indexOf(":");
  return { locationId: key.slice(0, splitAt), itemId: key.slice(splitAt + 1) };
}

export function applyDelta(
  balances: Map<string, number>,
  locationId: string,
  itemId: string,
  delta: number,
  itemLabel: string,
): void {
  const key = balanceKey(locationId, itemId);
  const current = balances.get(key) ?? 0;
  const next = current + delta;
  if (next < 0) {
    throw new InsufficientStockError(itemLabel, current, Math.abs(delta));
  }
  balances.set(key, next);
}

function requirePositiveQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
}

export function planReceive(input: {
  itemId: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  refType?: string;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
  clientId?: string | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, input.qty, input.itemId);
  return {
    balances,
    movements: [
      {
        type: "receive",
        itemId: input.itemId,
        qty: input.qty,
        toLocationId: input.locationId,
        refType: input.refType ?? "receipt",
        refId: input.refId,
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
        expiresOn: input.expiresOn ?? null,
        clientId: input.clientId ?? null,
      },
    ],
  };
}

export function planPick(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
  clientId?: string | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, -input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "pick",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.locationId,
        refType: "order",
        refId: input.refId,
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
        expiresOn: input.expiresOn ?? null,
        clientId: input.clientId ?? null,
      },
    ],
  };
}

export function planShip(input: {
  itemId: string;
  locationId: string;
  qty: number;
  refId: string;
  weightGrams?: number | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  return {
    balances: new Map(),
    movements: [
      {
        type: "ship",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.locationId,
        refType: "order",
        refId: input.refId,
        weightGrams: input.weightGrams ?? null,
      },
    ],
  };
}

export function planUnpick(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "unpick",
        itemId: input.itemId,
        qty: input.qty,
        toLocationId: input.locationId,
        refType: "order",
        refId: input.refId,
        reason: "Unpick",
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
        expiresOn: input.expiresOn ?? null,
      },
    ],
  };
}

export function planUnreceive(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
  clientId?: string | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, -input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "unreceive",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.locationId,
        refType: "asn",
        refId: input.refId,
        reason: "Unreceive carton",
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
        expiresOn: input.expiresOn ?? null,
        clientId: input.clientId ?? null,
      },
    ],
  };
}

export function planRtv(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, -input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "rtv",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.locationId,
        refType: "vendor_return",
        refId: input.refId,
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
      },
    ],
  };
}

export function planScrap(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, -input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "scrap",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.locationId,
        refType: "return",
        refId: input.refId,
        reason: "Return scrap",
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
        weightGrams: input.weightGrams ?? null,
        expiresOn: input.expiresOn ?? null,
      },
    ],
  };
}

export function planAdjust(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qtyDelta: number;
  reason: string;
  refId: string;
  balances: Map<string, number>;
  weightGrams?: number | null;
}): StockPlan {
  if (!Number.isInteger(input.qtyDelta) || input.qtyDelta === 0) {
    throw new Error("Adjustment quantity must be a non-zero integer");
  }
  if (!input.reason.trim()) {
    throw new Error("Adjustment reason is required");
  }
  const balances = new Map(input.balances);
  applyDelta(balances, input.locationId, input.itemId, input.qtyDelta, input.sku);
  return {
    balances,
    movements: [
      {
        type: "adjust",
        itemId: input.itemId,
        qty: Math.abs(input.qtyDelta),
        fromLocationId: input.qtyDelta < 0 ? input.locationId : null,
        toLocationId: input.qtyDelta > 0 ? input.locationId : null,
        refType: "adjustment",
        refId: input.refId,
        reason: input.reason.trim(),
        weightGrams: input.weightGrams ?? null,
      },
    ],
  };
}

export function planMove(input: {
  itemId: string;
  sku: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  refId: string;
  balances: Map<string, number>;
  refType?: string;
  lotCode?: string | null;
  serials?: string[] | null;
}): StockPlan {
  requirePositiveQty(input.qty);
  if (input.fromLocationId === input.toLocationId) {
    throw new Error("From and to locations must differ");
  }
  const balances = new Map(input.balances);
  applyDelta(balances, input.fromLocationId, input.itemId, -input.qty, input.sku);
  applyDelta(balances, input.toLocationId, input.itemId, input.qty, input.sku);
  return {
    balances,
    movements: [
      {
        type: "move",
        itemId: input.itemId,
        qty: input.qty,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        refType: input.refType ?? "move",
        refId: input.refId,
        lotCode: input.lotCode ?? null,
        serials: input.serials ?? null,
      },
    ],
  };
}

export function planCycleCount(input: {
  refId: string;
  locationId: string;
  lines: { itemId: string; sku: string; systemQty: number; countedQty: number; weightGrams?: number | null }[];
  balances: Map<string, number>;
}): StockPlan {
  const steps: Array<(balances: Map<string, number>) => StockPlan> = [];
  for (const line of input.lines) {
    if (!Number.isInteger(line.countedQty) || line.countedQty < 0) {
      throw new Error(`Counted quantity for ${line.sku} must be a non-negative integer`);
    }
    const delta = line.countedQty - line.systemQty;
    if (delta === 0) continue;
    steps.push((balances) =>
      planAdjust({
        itemId: line.itemId,
        sku: line.sku,
        locationId: input.locationId,
        qtyDelta: delta,
        reason: `Cycle count variance (${line.systemQty} → ${line.countedQty})`,
        refId: input.refId,
        balances,
        weightGrams: line.weightGrams ?? null,
      }),
    );
  }
  return chainPlans(input.balances, steps);
}

export function mergePlans(plans: StockPlan[]): StockPlan {
  const balances = new Map<string, number>();
  const movements: MovementDraft[] = [];
  for (const plan of plans) {
    for (const [key, qty] of plan.balances) {
      balances.set(key, qty);
    }
    movements.push(...plan.movements);
  }
  return { balances, movements };
}

export function foldPlans(initial: Map<string, number>, plans: StockPlan[]): StockPlan {
  const balances = new Map(initial);
  const movements: MovementDraft[] = [];
  for (const plan of plans) {
    for (const [key, qty] of plan.balances) {
      balances.set(key, qty);
    }
    movements.push(...plan.movements);
  }
  return { balances, movements };
}

export function chainPlans(
  initial: Map<string, number>,
  steps: Array<(balances: Map<string, number>) => StockPlan>,
): StockPlan {
  let balances = new Map(initial);
  const movements: MovementDraft[] = [];
  for (const step of steps) {
    const plan = step(balances);
    balances = plan.balances;
    movements.push(...plan.movements);
  }
  return { balances, movements };
}
