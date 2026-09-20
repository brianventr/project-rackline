export function isBlindCount(status: string): boolean {
  return status === "draft" || status === "counting";
}

export function isCountEntered(entered: boolean | number | null | undefined): boolean {
  return entered === true || entered === 1;
}

export function countVariance(countedQty: number, systemQty: number): number {
  return countedQty - systemQty;
}

export function countHasVariance(countedQty: number, systemQty: number): boolean {
  return countVariance(countedQty, systemQty) !== 0;
}

export function formatCountVariance(variance: number): string {
  if (variance > 0) return `+${variance}`;
  return String(variance);
}

export function allLinesEntered(lines: { entered?: boolean | number | null }[]): boolean {
  return lines.every((line) => isCountEntered(line.entered));
}

export function countHasItem(lines: { itemId: string }[], itemId: string): boolean {
  return lines.some((line) => line.itemId === itemId);
}

export function revealSystemQty(status: string, systemQty: number): number | null {
  return isBlindCount(status) ? null : systemQty;
}

export type CountEntry = {
  id: string;
  countedQty: number;
  entered: boolean;
};

export function applyCountEntries(stored: CountEntry[], incoming: { id?: string; countedQty?: number }[]): CountEntry[] {
  const countedById = new Map<string, number>();
  for (const line of incoming) {
    if (!line.id) continue;
    countedById.set(line.id, line.countedQty ?? 0);
  }
  return stored.map((line) =>
    countedById.has(line.id) ? { ...line, countedQty: countedById.get(line.id)!, entered: true } : line,
  );
}
