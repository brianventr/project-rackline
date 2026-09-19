import { suggestPickBay, type StockedBay } from "./partial-pick";

export type AllocationKey = {
  locationId: string;
  itemId: string;
};

export type OpenAllocation = AllocationKey & {
  id: string;
  orderId: string;
  orderLineId: string;
  qty: number;
  locationCode: string;
  sku: string;
};

export type AllocationQty = AllocationKey & {
  qty: number;
  orderId?: string;
};

export type AllocationDraft = AllocationKey & {
  orderLineId: string;
  qty: number;
  locationCode: string;
  sku: string;
};

export const ATP_RESTRICTED_TYPES = ["pick", "move", "kit_consume", "wo_consume"] as const;

export class InsufficientAtpError extends Error {
  constructor(
    public sku: string,
    public atp: number,
    public needed: number,
    public locationCode?: string,
  ) {
    super(
      locationCode
        ? `Not enough available ${sku} at ${locationCode}: ATP ${atp}, need ${needed}`
        : `Not enough available ${sku}: ATP ${atp}, need ${needed}`,
    );
    this.name = "InsufficientAtpError";
  }
}

export function isOpenAllocation(status: string): boolean {
  return status === "open";
}

export function isAtpRestrictedType(type: string): boolean {
  return (ATP_RESTRICTED_TYPES as readonly string[]).includes(type);
}

export function atpQty(onHand: number, allocated = 0): number {
  return Math.max(0, onHand - allocated);
}

export function allocatedQtyAt(
  allocations: AllocationQty[],
  locationId: string,
  itemId: string,
  excludeOrderId?: string,
): number {
  let qty = 0;
  for (const row of allocations) {
    if (row.locationId !== locationId || row.itemId !== itemId) continue;
    if (excludeOrderId && row.orderId === excludeOrderId) continue;
    qty += Math.max(0, row.qty);
  }
  return qty;
}

export function applyAllocationsToOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  onHand: T[],
  allocations: AllocationQty[],
  excludeOrderId?: string,
): T[] {
  return onHand.map((row) => ({
    ...row,
    qty: atpQty(row.qty, allocatedQtyAt(allocations, row.locationId, row.itemId, excludeOrderId)),
  }));
}

export function planAllocations(input: {
  lines: { lineId: string; itemId: string; sku: string; remaining: number }[];
  baysByItem: Map<string, StockedBay[]>;
}): { drafts: AllocationDraft[]; short: { sku: string; remaining: number; atp: number }[] } {
  const bays = new Map<string, StockedBay[]>();
  for (const [itemId, list] of input.baysByItem) {
    bays.set(
      itemId,
      list.map((row) => ({ ...row })),
    );
  }
  const drafts: AllocationDraft[] = [];
  const short: { sku: string; remaining: number; atp: number }[] = [];

  for (const line of input.lines) {
    if (!Number.isInteger(line.remaining) || line.remaining <= 0) continue;
    const pool = bays.get(line.itemId) ?? [];
    const atp = pool.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
    let need = line.remaining;
    while (need > 0) {
      const bay = suggestPickBay(pool, need);
      if (!bay || bay.qty <= 0) break;
      const take = Math.min(need, bay.qty);
      drafts.push({
        orderLineId: line.lineId,
        locationId: bay.locationId,
        locationCode: bay.locationCode,
        itemId: line.itemId,
        sku: line.sku,
        qty: take,
      });
      bay.qty -= take;
      need -= take;
    }
    if (need > 0) short.push({ sku: line.sku, remaining: need, atp });
  }

  return { drafts, short };
}

export function consumeAllocations(
  allocations: OpenAllocation[],
  orderLineId: string,
  locationId: string,
  qty: number,
): { id: string; qty: number }[] {
  if (!Number.isInteger(qty) || qty <= 0) return [];
  const mine = allocations.filter((row) => row.orderLineId === orderLineId && row.qty > 0);
  const ordered = [
    ...mine.filter((row) => row.locationId === locationId),
    ...mine.filter((row) => row.locationId !== locationId),
  ];
  let need = qty;
  const next = new Map(ordered.map((row) => [row.id, row.qty]));
  for (const row of ordered) {
    if (need <= 0) break;
    const current = next.get(row.id) ?? 0;
    const take = Math.min(current, need);
    next.set(row.id, current - take);
    need -= take;
  }
  return [...next.entries()]
    .filter(([id, remaining]) => remaining !== (allocations.find((row) => row.id === id)?.qty ?? remaining))
    .map(([id, remaining]) => ({ id, qty: remaining }));
}

export function assertAtpForMove(
  onHand: number,
  allocated: number,
  qty: number,
  sku: string,
  locationCode?: string,
): void {
  const atp = atpQty(onHand, allocated);
  if (qty > atp) throw new InsufficientAtpError(sku, atp, qty, locationCode);
}
