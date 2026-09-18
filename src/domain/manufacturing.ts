import { applyDelta, type MovementDraft, type StockPlan } from "./inventory";

export type BomComponent = {
  itemId: string;
  sku: string;
  qty: number;
};

export function explodeBom(components: BomComponent[], produceQty: number): BomComponent[] {
  if (!Number.isInteger(produceQty) || produceQty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  if (components.length === 0) {
    throw new Error("BOM has no components");
  }
  return components.map((line) => {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`BOM component ${line.sku} quantity must be a positive integer`);
    }
    return { ...line, qty: line.qty * produceQty };
  });
}

export function planCompleteWorkOrder(input: {
  workOrderId: string;
  finishedItemId: string;
  finishedSku: string;
  qty: number;
  sourceLocationId: string;
  outputLocationId: string;
  bomLines: BomComponent[];
  balances: Map<string, number>;
}): StockPlan {
  const exploded = explodeBom(input.bomLines, input.qty);
  const balances = new Map(input.balances);
  const movements: MovementDraft[] = [];

  for (const line of exploded) {
    applyDelta(balances, input.sourceLocationId, line.itemId, -line.qty, line.sku);
    movements.push({
      type: "wo_consume",
      itemId: line.itemId,
      qty: line.qty,
      fromLocationId: input.sourceLocationId,
      refType: "work_order",
      refId: input.workOrderId,
    });
  }

  applyDelta(
    balances,
    input.outputLocationId,
    input.finishedItemId,
    input.qty,
    input.finishedSku,
  );
  movements.push({
    type: "wo_produce",
    itemId: input.finishedItemId,
    qty: input.qty,
    toLocationId: input.outputLocationId,
    refType: "work_order",
    refId: input.workOrderId,
  });

  return { balances, movements };
}
