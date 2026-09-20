import { InsufficientStockError } from "./inventory";
import { ExpiredLotError, isExpiredLot, utcYyyymmdd } from "./expiry";

export type LotRow = {
  lotCode: string;
  qty: number;
  expiresOn?: number | null;
};

export function normalizeLotCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!code) throw new Error("Lot code is required");
  return code;
}

export function parseSerialList(value: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  return normalizeSerials(raw);
}

export function normalizeSerials(values: string[]): string[] {
  const serials: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const serial = value.trim().toUpperCase();
    if (!serial) continue;
    if (seen.has(serial)) {
      throw new Error(`Duplicate serial ${serial}`);
    }
    seen.add(serial);
    serials.push(serial);
  }
  return serials;
}

export function assertSerialQty(qty: number, serials: string[], sku: string): void {
  if (serials.length !== qty) {
    throw new Error(`${sku} needs ${qty} serial${qty === 1 ? "" : "s"} (got ${serials.length})`);
  }
}

export function allocateFifoLots(lots: LotRow[], qty: number, sku: string, asOf = utcYyyymmdd()): LotRow[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const live = lots.filter((row) => row.qty > 0 && !isExpiredLot(row.expiresOn, asOf));
  if (live.length === 0 && lots.some((row) => row.qty > 0 && isExpiredLot(row.expiresOn, asOf))) {
    throw new ExpiredLotError(sku);
  }
  const sorted = [...live]
    .map((row) => ({
      lotCode: row.lotCode.trim().toUpperCase(),
      qty: row.qty,
      expiresOn: row.expiresOn ?? null,
    }))
    .sort((a, b) => {
      const ae = a.expiresOn ?? Number.MAX_SAFE_INTEGER;
      const be = b.expiresOn ?? Number.MAX_SAFE_INTEGER;
      if (ae !== be) return ae - be;
      return a.lotCode.localeCompare(b.lotCode);
    });
  const allocated: LotRow[] = [];
  let remaining = qty;
  for (const row of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(row.qty, remaining);
    allocated.push({ lotCode: row.lotCode, qty: take, expiresOn: row.expiresOn });
    remaining -= take;
  }
  if (remaining > 0) {
    const onHand = live.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
    throw new InsufficientStockError(sku, onHand, qty);
  }
  return allocated;
}

export function allocateSerials(serials: string[], qty: number, sku: string): string[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const sorted = normalizeSerials(serials).sort((a, b) => a.localeCompare(b));
  if (sorted.length < qty) {
    throw new InsufficientStockError(sku, sorted.length, qty);
  }
  return sorted.slice(0, qty);
}

export function builtLotCode(at = new Date()): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `BUILT-${year}${month}${day}`;
}

export function generatedSerial(sku: string): string {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${sku.replace(/[^A-Z0-9]+/gi, "").toUpperCase() || "SN"}-${token}`;
}
