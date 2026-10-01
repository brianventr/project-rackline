import { ACTIVITY_RATES, type ActivityLine } from "./billing-types";

export type BillingRates = {
  storageCentsPerPiece: number;
  pickCentsPerUnit: number;
  cartonCents: number;
};

/** A client's own cents. Null on a field means that line uses the organization rate. */
export type ClientRateCard = {
  storageCentsPerPiece: number | null;
  pickCentsPerUnit: number | null;
  cartonCents: number | null;
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

/** Null or a missing card uses the organization rate. Zero is a real override. */
export function ratesForClient(org: BillingRates, card?: Partial<ClientRateCard> | null): BillingRates {
  return {
    storageCentsPerPiece: rateOrOrg(card?.storageCentsPerPiece, org.storageCentsPerPiece),
    pickCentsPerUnit: rateOrOrg(card?.pickCentsPerUnit, org.pickCentsPerUnit),
    cartonCents: rateOrOrg(card?.cartonCents, org.cartonCents),
  };
}

function rateOrOrg(value: number | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  return positiveInt(value, fallback);
}

export function rateActivity(
  input: {
    storagePieces: number;
    pickedUnits: number;
    shippedCartons: number;
  },
  rates: BillingRates = ACTIVITY_RATES,
  card?: Partial<ClientRateCard> | null,
): { lines: ActivityLine[]; amountCents: number } | null {
  const applied = ratesForClient(rates, card);
  const lines: ActivityLine[] = [];
  const storage = pieces(input.storagePieces);
  const picks = pieces(input.pickedUnits);
  const cartons = pieces(input.shippedCartons);
  if (storage > 0) {
    lines.push({
      kind: "storage",
      label: "On-hand pieces",
      qty: storage,
      unitCents: applied.storageCentsPerPiece,
      amountCents: storage * applied.storageCentsPerPiece,
    });
  }
  if (picks > 0) {
    lines.push({
      kind: "pick",
      label: "Picked units",
      qty: picks,
      unitCents: applied.pickCentsPerUnit,
      amountCents: picks * applied.pickCentsPerUnit,
    });
  }
  if (cartons > 0) {
    lines.push({
      kind: "carton",
      label: "Shipped cartons",
      qty: cartons,
      unitCents: applied.cartonCents,
      amountCents: cartons * applied.cartonCents,
    });
  }
  const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (amountCents <= 0) return null;
  return { lines, amountCents };
}
