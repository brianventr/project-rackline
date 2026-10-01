/** The public read-only page for one 3PL client. Prices appear only on that client's invoices. */

export const CLOSED_PORTAL_STATUSES = ["shipped", "cancelled"] as const;

export type PortalStockRow = { sku: string; name: string; qty: number };
export type PortalOrderRow = { number: string; status: string; shipToCity: string | null };
export type PortalShipmentRow = {
  orderNumber: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string | null;
};
export type PortalInvoiceRow = {
  number: string;
  amountCents: number;
  status: string;
  periodStart: number;
  periodEnd: number;
  linesJson: string;
};

export type PortalInvoiceLine = {
  kind: string;
  label: string;
  qty: number;
  unitCents: number;
  amountCents: number;
};

export function portalInvoiceLines(linesJson: string | null | undefined): PortalInvoiceLine[] {
  if (!linesJson) return [];
  try {
    const parsed = JSON.parse(linesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const lines: PortalInvoiceLine[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const line = row as Record<string, unknown>;
      if (typeof line.amountCents !== "number") continue;
      lines.push({
        kind: typeof line.kind === "string" ? line.kind : "line",
        label: typeof line.label === "string" ? line.label : "Line",
        qty: typeof line.qty === "number" ? line.qty : 0,
        unitCents: typeof line.unitCents === "number" ? line.unitCents : 0,
        amountCents: line.amountCents,
      });
    }
    return lines;
  } catch {
    return [];
  }
}

export function clientPortalBody(input: {
  organizationName: string;
  clientCode: string;
  clientName: string;
  stock: PortalStockRow[];
  orders: PortalOrderRow[];
  shipments: PortalShipmentRow[];
  invoices: PortalInvoiceRow[];
}) {
  return {
    organizationName: input.organizationName,
    client: { code: input.clientCode, name: input.clientName },
    stock: input.stock
      .filter((row) => row.qty > 0)
      .map((row) => ({ sku: row.sku, name: row.name, qty: row.qty })),
    orders: input.orders
      .filter((row) => !CLOSED_PORTAL_STATUSES.includes(row.status as (typeof CLOSED_PORTAL_STATUSES)[number]))
      .map((row) => ({ number: row.number, status: row.status, city: row.shipToCity })),
    shipments: input.shipments.map((row) => ({
      orderNumber: row.orderNumber,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      status: row.status || "shipped",
    })),
    invoices: input.invoices.map((row) => ({
      number: row.number,
      amountCents: row.amountCents,
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      lines: portalInvoiceLines(row.linesJson),
    })),
  };
}
