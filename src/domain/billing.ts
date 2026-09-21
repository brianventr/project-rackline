export const ACTIVITY_RATES = {
  storageCentsPerPiece: 2,
  pickCentsPerUnit: 25,
  cartonCents: 150,
} as const;

export type ActivityLine = {
  kind: "storage" | "pick" | "carton";
  label: string;
  qty: number;
  unitCents: number;
  amountCents: number;
};

function pieces(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function rateActivity(input: {
  storagePieces: number;
  pickedUnits: number;
  shippedCartons: number;
}): { lines: ActivityLine[]; amountCents: number } | null {
  const lines: ActivityLine[] = [];
  const storage = pieces(input.storagePieces);
  const picks = pieces(input.pickedUnits);
  const cartons = pieces(input.shippedCartons);
  if (storage > 0) {
    lines.push({
      kind: "storage",
      label: "On-hand pieces",
      qty: storage,
      unitCents: ACTIVITY_RATES.storageCentsPerPiece,
      amountCents: storage * ACTIVITY_RATES.storageCentsPerPiece,
    });
  }
  if (picks > 0) {
    lines.push({
      kind: "pick",
      label: "Picked units",
      qty: picks,
      unitCents: ACTIVITY_RATES.pickCentsPerUnit,
      amountCents: picks * ACTIVITY_RATES.pickCentsPerUnit,
    });
  }
  if (cartons > 0) {
    lines.push({
      kind: "carton",
      label: "Shipped cartons",
      qty: cartons,
      unitCents: ACTIVITY_RATES.cartonCents,
      amountCents: cartons * ACTIVITY_RATES.cartonCents,
    });
  }
  const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (amountCents <= 0) return null;
  return { lines, amountCents };
}
