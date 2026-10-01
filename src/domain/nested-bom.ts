/** Walk made components. Depth is how many recipes are open, and 5 is the deepest recipe we open. */

export const BOM_MAX_DEPTH = 5;

export class BomCycleError extends Error {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Recipe cycle: ${cycle.join(" → ")}`);
    this.name = "BomCycleError";
    this.cycle = cycle;
  }
}

export class BomDepthError extends Error {
  constructor() {
    super(`Recipe is nested more than ${BOM_MAX_DEPTH} levels`);
    this.name = "BomDepthError";
  }
}

export type BomGraphLine = { itemId: string; qty: number };

export type BomGraphNode = { itemId: string; lines: readonly BomGraphLine[] };

export type ExplodedComponent = {
  itemId: string;
  qty: number;
  depth: number;
  parentItemId: string;
};

export type MadeShortfall = {
  itemId: string;
  sku: string;
  needed: number;
  onHand: number;
  shortQty: number;
};

/**
 * Components of `itemId`, then components of those when they have a recipe.
 * Depth 1 is a direct component. A cycle throws BomCycleError. Past depth 5 throws BomDepthError.
 */
export function explodeBom(input: { itemId: string; qty: number; boms: readonly BomGraphNode[] }): ExplodedComponent[] {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const byItem = new Map<string, readonly BomGraphLine[]>();
  for (const bom of input.boms) byItem.set(bom.itemId, bom.lines);

  const out: ExplodedComponent[] = [];
  const walk = (itemId: string, qty: number, path: string[]) => {
    if (path.includes(itemId)) throw new BomCycleError([...path, itemId]);
    const lines = byItem.get(itemId);
    if (!lines || lines.length === 0) return;
    if (path.length >= BOM_MAX_DEPTH) throw new BomDepthError();
    const next = [...path, itemId];
    for (const line of lines) {
      if (!Number.isInteger(line.qty) || line.qty <= 0) {
        throw new Error("Component quantity must be a positive integer");
      }
      const componentQty = line.qty * qty;
      out.push({ itemId: line.itemId, qty: componentQty, depth: next.length, parentItemId: itemId });
      walk(line.itemId, componentQty, next);
    }
  };
  walk(input.itemId, input.qty, []);
  return out;
}

/** Every recipe in the graph, so a cycle or a too-deep chain is caught from any parent. */
export function assertBomGraph(boms: readonly BomGraphNode[]): void {
  for (const bom of boms) explodeBom({ itemId: bom.itemId, qty: 1, boms });
}

/** Direct components that are themselves made and short for this produce qty. */
export function madeComponentShortfalls(input: {
  lines: readonly { itemId: string; sku: string; qty: number }[];
  madeItemIds: ReadonlySet<string>;
  produceQty: number;
  onHandByItem: ReadonlyMap<string, number>;
}): MadeShortfall[] {
  const out: MadeShortfall[] = [];
  for (const line of input.lines) {
    if (!input.madeItemIds.has(line.itemId)) continue;
    const needed = line.qty * input.produceQty;
    const onHand = Math.max(0, input.onHandByItem.get(line.itemId) ?? 0);
    const shortQty = needed - onHand;
    if (shortQty > 0) out.push({ itemId: line.itemId, sku: line.sku, needed, onHand, shortQty });
  }
  return out;
}
