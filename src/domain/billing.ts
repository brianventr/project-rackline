export const RATE_KINDS = ["receive", "storage", "pick", "carton", "kit", "work_order", "rma"] as const;

export type RateKind = (typeof RATE_KINDS)[number];

export const RATE_LABELS: Record<RateKind, string> = {
  receive: "Received units",
  storage: "On-hand pieces",
  pick: "Picked units",
  carton: "Shipped cartons",
  kit: "Kits completed",
  work_order: "Work orders completed",
  rma: "Returns received",
};

export type ActivityLine = {
  kind: RateKind;
  label: string;
  qty: number;
  unitCents: number;
  amountCents: number;
  refType?: string;
  refId?: string;
  refNumber?: string;
};

export type ActivitySlice = {
  kind: RateKind;
  qty: number;
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
};

export function isRateKind(value: string): value is RateKind {
  return (RATE_KINDS as readonly string[]).includes(value);
}

function pieces(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function cents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** Bill only kinds the client has a stored rate for. A missing rate skips that activity. */
export function rateActivity(
  slices: ActivitySlice[],
  rates: Partial<Record<RateKind, number>>,
): { lines: ActivityLine[]; amountCents: number } | null {
  const lines: ActivityLine[] = [];
  const ordered = [...slices].sort((a, b) => {
    const kind = RATE_KINDS.indexOf(a.kind) - RATE_KINDS.indexOf(b.kind);
    if (kind !== 0) return kind;
    return (a.refNumber ?? "").localeCompare(b.refNumber ?? "");
  });
  for (const slice of ordered) {
    const qty = pieces(slice.qty);
    if (qty <= 0) continue;
    if (!isRateKind(slice.kind)) continue;
    if (!(slice.kind in rates)) continue;
    const unitCents = cents(rates[slice.kind] ?? NaN);
    if (unitCents === null) continue;
    const line: ActivityLine = {
      kind: slice.kind,
      label: RATE_LABELS[slice.kind],
      qty,
      unitCents,
      amountCents: qty * unitCents,
    };
    if (slice.refType) line.refType = slice.refType;
    if (slice.refId) line.refId = slice.refId;
    if (slice.refNumber) line.refNumber = slice.refNumber;
    lines.push(line);
  }
  const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (amountCents <= 0) return null;
  return { lines, amountCents };
}

export function isBillingEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function invoiceMailText(input: {
  number: string;
  clientName: string;
  lines: ActivityLine[];
  amountCents: number;
}): { subject: string; text: string } {
  const body = input.lines
    .map((line) => {
      const ref = line.refNumber ? ` (${line.refNumber})` : "";
      return `${line.label}${ref} × ${line.qty} @ ${money(line.unitCents)} = ${money(line.amountCents)} USD`;
    })
    .join("\n");
  return {
    subject: `Invoice ${input.number}`,
    text: [`Invoice ${input.number}`, input.clientName, "", body, "", `Total ${money(input.amountCents)} USD`].join("\n"),
  };
}
