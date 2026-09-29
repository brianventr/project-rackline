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
