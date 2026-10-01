/**
 * Accounting export — inventory valuation for QBO/Xero CSV import (v1).
 * v1 is export-only; live journal sync is a later iteration.
 */

export type ValuationRow = {
  sku: string;
  name: string;
  locationCode: string;
  qty: number;
  unitCostCents: number;
  amountCents: number;
};

export function buildValuationRows(
  rows: Array<{ sku: string; name: string; locationCode: string; qty: number; unitCostCents: number }>,
): ValuationRow[] {
  return rows
    .filter((r) => r.qty > 0)
    .map((r) => ({
      ...r,
      amountCents: r.qty * Math.max(0, Math.floor(r.unitCostCents)),
    }));
}

export function valuationToCsv(rows: ValuationRow[], asOfIso: string): string {
  const header = ["As Of", "SKU", "Name", "Location", "Qty", "Unit Cost", "Amount", "Account Hint"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        asOfIso,
        csvEscape(row.sku),
        csvEscape(row.name),
        csvEscape(row.locationCode),
        String(row.qty),
        (row.unitCostCents / 100).toFixed(2),
        (row.amountCents / 100).toFixed(2),
        "Inventory Asset",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export type CogsMovementRow = {
  dateIso: string;
  sku: string;
  movementType: string;
  qty: number;
  unitCostCents: number;
  amountCents: number;
  refType: string;
  refId: string;
};

export type InvoiceExportLine = {
  kind?: string;
  label?: string;
  qty?: number;
  unitCents?: number;
  amountCents?: number;
};

export type InvoiceExportRow = {
  number: string;
  clientCode: string | null;
  status: string;
  periodStart: number;
  periodEnd: number;
  amountCents: number;
  lines: InvoiceExportLine[];
};

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One CSV row per stored invoice line. An invoice with no lines is one row for the invoice total. */
export function invoicesToCsv(rows: InvoiceExportRow[]): string {
  const header = ["Invoice", "Client", "Status", "Period Start", "Period End", "Line", "Qty", "Unit Amount", "Amount", "Account Hint"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const start = isoDate(row.periodStart);
    const end = isoDate(row.periodEnd);
    const detail =
      row.lines.length > 0
        ? row.lines
        : [{ label: "Invoice", qty: 1, unitCents: row.amountCents, amountCents: row.amountCents }];
    for (const line of detail) {
      const qty = typeof line.qty === "number" ? line.qty : 1;
      const amount = typeof line.amountCents === "number" ? line.amountCents : row.amountCents;
      const unit = typeof line.unitCents === "number" ? line.unitCents : qty ? Math.round(amount / qty) : amount;
      lines.push(
        [
          csvEscape(row.number),
          csvEscape(row.clientCode ?? ""),
          csvEscape(row.status),
          start,
          end,
          csvEscape(line.label || line.kind || "Invoice"),
          String(qty),
          (unit / 100).toFixed(2),
          (amount / 100).toFixed(2),
          "3PL Income",
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function cogsMovementsToCsv(rows: CogsMovementRow[]): string {
  const header = ["Date", "SKU", "Type", "Qty", "Unit Cost", "Amount", "Ref Type", "Ref Id", "Account Hint"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.dateIso,
        csvEscape(row.sku),
        csvEscape(row.movementType),
        String(row.qty),
        (row.unitCostCents / 100).toFixed(2),
        (row.amountCents / 100).toFixed(2),
        csvEscape(row.refType),
        csvEscape(row.refId),
        row.qty < 0 ? "COGS" : "Inventory Asset",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
