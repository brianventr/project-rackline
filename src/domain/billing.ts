import { ACTIVITY_RATES, type ActivityLine } from "./billing-types";

export type BillingRates = {
  storageCentsPerPiece: number;
  pickCentsPerUnit: number;
  cartonCents: number;
};

export { ACTIVITY_RATES };
export type { ActivityLine };

export function parseBillingRates(value: string | null | undefined): BillingRates {
  if (!value) return { ...ACTIVITY_RATES };
  try {
    const parsed = JSON.parse(value) as Partial<BillingRates>;
    return {
      storageCentsPerPiece: positiveInt(parsed.storageCentsPerPiece, ACTIVITY_RATES.storageCentsPerPiece),
      pickCentsPerUnit: positiveInt(parsed.pickCentsPerUnit, ACTIVITY_RATES.pickCentsPerUnit),
      cartonCents: positiveInt(parsed.cartonCents, ACTIVITY_RATES.cartonCents),
    };
  } catch {
    return { ...ACTIVITY_RATES };
  }
}

export function serializeBillingRates(rates: BillingRates): string {
  return JSON.stringify({
    storageCentsPerPiece: rates.storageCentsPerPiece,
    pickCentsPerUnit: rates.pickCentsPerUnit,
    cartonCents: rates.cartonCents,
  });
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function pieces(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function rateActivity(
  input: {
    storagePieces: number;
    pickedUnits: number;
    shippedCartons: number;
  },
  rates: BillingRates = ACTIVITY_RATES,
): { lines: ActivityLine[]; amountCents: number } | null {
  const lines: ActivityLine[] = [];
  const storage = pieces(input.storagePieces);
  const picks = pieces(input.pickedUnits);
  const cartons = pieces(input.shippedCartons);
  if (storage > 0) {
    lines.push({
      kind: "storage",
      label: "On-hand pieces",
      qty: storage,
      unitCents: rates.storageCentsPerPiece,
      amountCents: storage * rates.storageCentsPerPiece,
    });
  }
  if (picks > 0) {
    lines.push({
      kind: "pick",
      label: "Picked units",
      qty: picks,
      unitCents: rates.pickCentsPerUnit,
      amountCents: picks * rates.pickCentsPerUnit,
    });
  }
  if (cartons > 0) {
    lines.push({
      kind: "carton",
      label: "Shipped cartons",
      qty: cartons,
      unitCents: rates.cartonCents,
      amountCents: cartons * rates.cartonCents,
    });
  }
  const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (amountCents <= 0) return null;
  return { lines, amountCents };
}
