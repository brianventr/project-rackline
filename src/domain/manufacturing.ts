import { applyDelta, type MovementDraft, type MovementType, type StockPlan } from "./inventory";

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
  refType?: string;
  consumeType?: MovementType;
  produceType?: MovementType;
  outputLotCode?: string | null;
  outputSerials?: string[] | null;
}): StockPlan {
  const exploded = explodeBom(input.bomLines, input.qty);
  const balances = new Map(input.balances);
  const movements: MovementDraft[] = [];
  const refType = input.refType ?? "work_order";
  const consumeType = input.consumeType ?? "wo_consume";
  const produceType = input.produceType ?? "wo_produce";

  for (const line of exploded) {
    applyDelta(balances, input.sourceLocationId, line.itemId, -line.qty, line.sku);
    movements.push({
      type: consumeType,
      itemId: line.itemId,
      qty: line.qty,
      fromLocationId: input.sourceLocationId,
      refType,
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
    type: produceType,
    itemId: input.finishedItemId,
    qty: input.qty,
    toLocationId: input.outputLocationId,
    refType,
    refId: input.workOrderId,
    lotCode: input.outputLotCode ?? null,
    serials: input.outputSerials ?? null,
  });

  return { balances, movements };
}

export function planCompleteKit(input: {
  kitId: string;
  finishedItemId: string;
  finishedSku: string;
  qty: number;
  sourceLocationId: string;
  outputLocationId: string;
  bomLines: BomComponent[];
  balances: Map<string, number>;
  outputLotCode?: string | null;
  outputSerials?: string[] | null;
}): StockPlan {
  return planCompleteWorkOrder({
    workOrderId: input.kitId,
    finishedItemId: input.finishedItemId,
    finishedSku: input.finishedSku,
    qty: input.qty,
    sourceLocationId: input.sourceLocationId,
    outputLocationId: input.outputLocationId,
    bomLines: input.bomLines,
    balances: input.balances,
    refType: "kit",
    consumeType: "kit_consume",
    produceType: "kit_produce",
    outputLotCode: input.outputLotCode,
    outputSerials: input.outputSerials,
  });
}
