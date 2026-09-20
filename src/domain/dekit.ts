import { applyDelta, type MovementDraft, type StockPlan } from "./inventory";
import type { AsBuiltView } from "./as-built";

export type DekitComponent = {
  itemId: string;
  sku: string;
  qty: number;
  lotCode: string | null;
  serials: string[] | null;
};

export function collapseDekitParents(
  asBuilt: AsBuiltView[],
  qty: number,
): { lotCode: string | null; serials: string[] | null; qty: number } {
  const serials = [...new Set(asBuilt.map((row) => row.parentSerial).filter((value): value is string => Boolean(value)))];
  const lots = [...new Set(asBuilt.map((row) => row.parentLotCode).filter((value): value is string => Boolean(value)))];
  return {
    qty,
    serials: serials.length ? serials : null,
    lotCode: lots.length === 1 ? lots[0]! : null,
  };
}

export function collapseDekitComponents(asBuilt: AsBuiltView[]): DekitComponent[] {
  const grouped = new Map<string, DekitComponent>();
  for (const row of asBuilt) {
    const serial = row.componentSerial;
    const key = serial ? `${row.componentItemId}::${serial}` : `${row.componentItemId}:${row.componentLotCode ?? ""}:`;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += row.qty;
      if (serial && existing.serials && !existing.serials.includes(serial)) {
        existing.serials.push(serial);
        existing.qty = existing.serials.length;
      }
      continue;
    }
    grouped.set(key, {
      itemId: row.componentItemId,
      sku: row.componentSku,
      qty: row.qty,
      lotCode: row.componentLotCode,
      serials: serial ? [serial] : null,
    });
  }
  return [...grouped.values()];
}

export function planDekit(input: {
  kitId: string;
  finishedItemId: string;
  finishedSku: string;
  qty: number;
  sourceLocationId: string;
  outputLocationId: string;
  asBuilt: AsBuiltView[];
  balances: Map<string, number>;
}): StockPlan {
  if (input.asBuilt.length === 0) {
    throw new Error("Kit has no as-built to reverse");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }

  const balances = new Map(input.balances);
  const movements: MovementDraft[] = [];
  const finished = collapseDekitParents(input.asBuilt, input.qty);
  applyDelta(balances, input.outputLocationId, input.finishedItemId, -finished.qty, input.finishedSku);
  movements.push({
    type: "kit_consume",
    itemId: input.finishedItemId,
    qty: finished.qty,
    fromLocationId: input.outputLocationId,
    refType: "kit",
    refId: input.kitId,
    lotCode: finished.lotCode,
    serials: finished.serials,
    reason: "Dekit",
  });

  for (const component of collapseDekitComponents(input.asBuilt)) {
    applyDelta(balances, input.sourceLocationId, component.itemId, component.qty, component.sku);
    movements.push({
      type: "receive",
      itemId: component.itemId,
      qty: component.qty,
      toLocationId: input.sourceLocationId,
      refType: "kit",
      refId: input.kitId,
      lotCode: component.lotCode,
      serials: component.serials,
      reason: "Dekit",
    });
  }

  return { balances, movements };
}
