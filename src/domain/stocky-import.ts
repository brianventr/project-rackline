/**
 * Stocky purchase-order and stocktake CSVs. Suppliers are not a separate Stocky export;
 * the supplier column on the PO creates the vendor. Closed POs are skipped.
 */

export type StockyPoLine = {
  line: number;
  poNumber: string;
  supplier: string;
  sku: string;
  name: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostCents: number | null;
};

export type StockyPurchase = {
  poNumber: string;
  supplier: string;
  lines: StockyPoLine[];
};

export type StockyCountLine = {
  line: number;
  sku: string;
  name: string;
  counted: number;
};

export type StockyParseResult = {
  kind: "purchase" | "stocktake";
  purchases: StockyPurchase[];
  counts: StockyCountLine[];
  errors: string[];
};

const CLOSED = new Set(["received", "closed", "cancelled", "canceled", "complete", "completed"]);

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, "");
}

function indexOf(headers: string[], aliases: string[]): number {
  const keys = headers.map(norm);
  for (const alias of aliases) {
    const at = keys.indexOf(norm(alias));
    if (at >= 0) return at;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function whole(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function cents(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function parseStockyCsv(csv: string): StockyParseResult {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { kind: "purchase", purchases: [], counts: [], errors: ["Paste a header row and at least one line."] };
  const headers = splitCsvLine(lines[0]!);
  const skuAt = indexOf(headers, ["sku", "variant sku", "product sku"]);
  const supplierAt = indexOf(headers, ["supplier", "vendor", "supplier name"]);
  const countedAt = indexOf(headers, ["counted", "counted qty", "counted quantity", "count"]);
  if (skuAt < 0) return { kind: "purchase", purchases: [], counts: [], errors: ["Need a SKU column."] };

  if (supplierAt >= 0) {
    const poAt = indexOf(headers, ["po number", "purchase order", "po", "number", "order number"]);
    const nameAt = indexOf(headers, ["product", "product title", "title", "name", "description"]);
    const qtyAt = indexOf(headers, ["quantity ordered", "qty ordered", "ordered", "quantity", "qty"]);
    const receivedAt = indexOf(headers, ["quantity received", "qty received", "received"]);
    const costAt = indexOf(headers, ["cost", "unit cost", "price", "cost price"]);
    const statusAt = indexOf(headers, ["status", "po status"]);
    if (qtyAt < 0) return { kind: "purchase", purchases: [], counts: [], errors: ["Need a quantity column."] };
    const byPo = new Map<string, StockyPurchase>();
    for (let i = 1; i < lines.length; i++) {
      const row = splitCsvLine(lines[i]!);
      const status = cell(row, statusAt).toLowerCase();
      if (status && CLOSED.has(status)) continue;
      const sku = cell(row, skuAt);
      const supplier = cell(row, supplierAt);
      const qty = whole(cell(row, qtyAt));
      if (!sku || !supplier || qty == null || qty <= 0) {
        errors.push(`Line ${i + 1} needs a supplier, SKU, and quantity.`);
        continue;
      }
      const poNumber = cell(row, poAt) || `STOCKY-${supplier}`;
      const key = `${poNumber}\0${supplier}`.toLowerCase();
      const purchase = byPo.get(key) ?? { poNumber, supplier, lines: [] };
      purchase.lines.push({
        line: i + 1,
        poNumber,
        supplier,
        sku,
        name: cell(row, nameAt) || sku,
        qtyOrdered: qty,
        qtyReceived: whole(cell(row, receivedAt)) ?? 0,
        unitCostCents: cents(cell(row, costAt)),
      });
      byPo.set(key, purchase);
    }
    return { kind: "purchase", purchases: [...byPo.values()], counts: [], errors };
  }

  if (countedAt >= 0) {
    const nameAt = indexOf(headers, ["product", "product title", "title", "name"]);
    const counts: StockyCountLine[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = splitCsvLine(lines[i]!);
      const sku = cell(row, skuAt);
      const counted = whole(cell(row, countedAt));
      if (!sku || counted == null) {
        errors.push(`Line ${i + 1} needs a SKU and a counted quantity.`);
        continue;
      }
      counts.push({ line: i + 1, sku, name: cell(row, nameAt) || sku, counted });
    }
    return { kind: "stocktake", purchases: [], counts, errors };
  }

  return {
    kind: "purchase",
    purchases: [],
    counts: [],
    errors: ["This CSV needs a supplier column (purchase order) or a counted column (stocktake)."],
  };
}
