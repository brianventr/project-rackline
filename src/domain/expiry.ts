export const EXPIRING_WITHIN_DAYS = 14;

export class ExpiredLotError extends Error {
  constructor(
    public sku: string,
    public lotCode?: string,
    public expiresOn?: number | null,
  ) {
    super(
      lotCode
        ? `${sku} lot ${lotCode} expired ${formatExpiresOn(expiresOn)}`
        : `${sku} has no unexpired lots at this bay`,
    );
    this.name = "ExpiredLotError";
  }
}

export function utcYyyymmdd(at = new Date()): number {
  return at.getUTCFullYear() * 10000 + (at.getUTCMonth() + 1) * 100 + at.getUTCDate();
}

export function addUtcDays(yyyymmdd: number, days: number): number {
  const year = Math.floor(yyyymmdd / 10000);
  const month = Math.floor((yyyymmdd % 10000) / 100) - 1;
  const day = yyyymmdd % 100;
  const at = new Date(Date.UTC(year, month, day + days));
  return utcYyyymmdd(at);
}

export function parseExpiresOn(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 19000101 && raw <= 99991231) {
    return assertCalendarDay(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      return assertCalendarDay(Number(`${iso[1]}${iso[2]}${iso[3]}`));
    }
    if (/^\d{8}$/.test(trimmed)) {
      return assertCalendarDay(Number(trimmed));
    }
  }
  throw new Error("Expiry must be a calendar date (YYYY-MM-DD)");
}

function assertCalendarDay(value: number): number {
  const year = Math.floor(value / 10000);
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() + 1 !== month || at.getUTCDate() !== day) {
    throw new Error("Expiry must be a calendar date (YYYY-MM-DD)");
  }
  return value;
}

export function formatExpiresOn(value: number | null | undefined): string {
  if (value == null) return "—";
  const year = Math.floor(value / 10000);
  const month = String(Math.floor((value % 10000) / 100)).padStart(2, "0");
  const day = String(value % 100).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function requireExpiry(trackExpiry: boolean, sku: string, raw: unknown): number | null {
  if (!trackExpiry) {
    if (raw === undefined || raw === null || raw === "") return null;
    return parseExpiresOn(raw);
  }
  if (raw === undefined || raw === null || raw === "") {
    throw new Error(`${sku} requires an expiry date`);
  }
  return parseExpiresOn(raw);
}

export function isExpiredLot(expiresOn: number | null | undefined, asOf = utcYyyymmdd()): boolean {
  return expiresOn != null && expiresOn < asOf;
}

export function isExpiringLot(
  expiresOn: number | null | undefined,
  asOf = utcYyyymmdd(),
  withinDays = EXPIRING_WITHIN_DAYS,
): boolean {
  if (expiresOn == null) return false;
  return expiresOn <= addUtcDays(asOf, withinDays);
}

export function assertLotNotExpired(
  sku: string,
  lotCode: string,
  expiresOn: number | null | undefined,
  asOf = utcYyyymmdd(),
): void {
  if (isExpiredLot(expiresOn, asOf)) {
    throw new ExpiredLotError(sku, lotCode, expiresOn);
  }
}

export function assertSameLotExpiry(
  _sku: string,
  lotCode: string,
  existing: number | null | undefined,
  incoming: number | null | undefined,
): void {
  if (existing == null || incoming == null) return;
  if (existing !== incoming) {
    throw new Error(`Lot ${lotCode} already expires ${formatExpiresOn(existing)}`);
  }
}
