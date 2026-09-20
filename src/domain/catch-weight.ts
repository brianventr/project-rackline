export function formatCatchWeight(grams: number | null | undefined): string {
  if (grams == null) return "—";
  return `${grams} g`;
}

export function requireCatchWeight(catchWeight: boolean, sku: string, weightGrams: unknown): number | null {
  if (!catchWeight) return null;
  if (weightGrams === undefined || weightGrams === null || weightGrams === "") {
    throw new Error(`${sku} is catch-weight; enter weight in grams`);
  }
  const n = typeof weightGrams === "number" ? weightGrams : Number(weightGrams);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${sku} catch-weight must be a positive integer (grams)`);
  }
  return n;
}

export function requireCountCatchWeight(
  catchWeight: boolean,
  sku: string,
  countedQty: number,
  weightGrams: unknown,
): number | null {
  if (!catchWeight || countedQty === 0) return null;
  return requireCatchWeight(true, sku, weightGrams);
}

export function splitCatchWeight(totalGrams: number | null | undefined, qtys: number[]): Array<number | null> {
  if (totalGrams == null) return qtys.map(() => null);
  const totalQty = qtys.reduce((sum, qty) => sum + qty, 0);
  if (totalQty <= 0) return qtys.map(() => null);
  const shares: Array<number | null> = [];
  let used = 0;
  for (let index = 0; index < qtys.length; index += 1) {
    if (index === qtys.length - 1) {
      shares.push(totalGrams - used);
    } else {
      const share = Math.floor((totalGrams * qtys[index]!) / totalQty);
      shares.push(share);
      used += share;
    }
  }
  return shares;
}
