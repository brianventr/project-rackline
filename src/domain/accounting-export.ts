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
