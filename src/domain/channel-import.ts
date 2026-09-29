/**
 * Channel CSV ingest for Etsy and Faire (Shopify stays on its own webhook path).
 */

export type ChannelKind = "etsy" | "faire";

export type ChannelOrderRow = {
  line: number;
  externalId: string;
  customerName: string;
  sku: string;
  qty: number;
  address?: string;
};

export type ChannelParseResult = {
  channel: ChannelKind;
  rows: ChannelOrderRow[];
  errors: string[];
};

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

function idx(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  for (const a of aliases) {
    const i = lower.indexOf(a.toLowerCase().replace(/[\s_-]+/g, ""));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseChannelCsv(channel: ChannelKind, csv: string): ChannelParseResult {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { channel, rows: [], errors: ["CSV needs header and data"] };
  const headers = splitCsvLine(lines[0]!);
  const idIdx = idx(headers, ["order id", "orderid", "receipt id", "po number", "faire order", "external id"]);
  const nameIdx = idx(headers, ["buyer", "customer", "name", "ship name", "retailer"]);
  const skuIdx = idx(headers, ["sku", "listing sku", "product sku", "item sku"]);
  const qtyIdx = idx(headers, ["qty", "quantity", "units"]);
  const addressIdx = idx(headers, ["address", "ship to", "shipping address"]);
  if (idIdx < 0) errors.push("Missing order id column");
  if (nameIdx < 0) errors.push("Missing customer/buyer column");
  if (skuIdx < 0) errors.push("Missing sku column");
  if (errors.length) return { channel, rows: [], errors };

  const rows: ChannelOrderRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const externalId = cells[idIdx!] ?? "";
    const customerName = cells[nameIdx!] ?? "";
    const sku = cells[skuIdx!] ?? "";
    const qty = qtyIdx >= 0 ? Number.parseInt(cells[qtyIdx] ?? "1", 10) : 1;
    if (!externalId || !customerName || !sku || !Number.isFinite(qty) || qty <= 0) {
      errors.push(`Line ${i + 1}: invalid order row`);
      continue;
    }
    rows.push({
      line: i + 1,
      externalId,
      customerName,
      sku,
      qty,
      address: addressIdx >= 0 ? cells[addressIdx] || undefined : undefined,
    });
  }
  return { channel, rows, errors };
}

/** Collapse rows that share an external order id into one order with multiple lines. */
export function groupChannelRows(rows: ChannelOrderRow[]): Map<string, ChannelOrderRow[]> {
  const map = new Map<string, ChannelOrderRow[]>();
  for (const row of rows) {
    const list = map.get(row.externalId) ?? [];
    list.push(row);
    map.set(row.externalId, list);
  }
  return map;
}
