/**
 * Crowdfunding / pledge CSV import — BackerKit, Gamefound, Kickstarter-style exports.
 * Maps rows to outbound orders (and optional wave). Kit recipe mapping is SKU-based.
 */

export type CrowdfundingSource = "backerkit" | "gamefound" | "kickstarter" | "generic";

export type CrowdfundingImportRow = {
  line: number;
  backerName: string;
  email?: string;
  rewardSku: string;
  qty: number;
  address?: string;
  tierCode?: string;
  addOnSkus?: string[];
};

export type CrowdfundingParseResult = {
  source: CrowdfundingSource;
  rows: CrowdfundingImportRow[];
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
      } else {
        inQuotes = !inQuotes;
      }
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

function headerIndex(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/[\s_]+/g, ""));
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/[\s_]+/g, "");
    const idx = lower.indexOf(key);
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectSource(headers: string[]): CrowdfundingSource {
  const joined = headers.join(" ").toLowerCase();
  if (joined.includes("backerkit") || joined.includes("pledge manager")) return "backerkit";
  if (joined.includes("gamefound") || joined.includes("stretch")) return "gamefound";
  if (joined.includes("kickstarter") || joined.includes("backer number")) return "kickstarter";
  return "generic";
}

/**
 * Parse a pledge CSV. Required columns (aliases accepted):
 * - backer / name / customer
 * - sku / reward / item / tier sku
 * - qty / quantity (default 1)
 * Optional: email, address / ship to, tier, addons (pipe or semicolon separated SKUs)
 */
export function parseCrowdfundingCsv(csv: string): CrowdfundingParseResult {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) {
    return { source: "generic", rows: [], errors: ["CSV needs a header row and at least one data row"] };
  }
  const headers = splitCsvLine(lines[0]!);
  const source = detectSource(headers);
  const nameIdx = headerIndex(headers, ["backer", "name", "customer", "backername", "full name", "shipping name"]);
  const skuIdx = headerIndex(headers, ["sku", "reward", "item", "rewardsku", "tiersku", "product sku", "item sku"]);
  const qtyIdx = headerIndex(headers, ["qty", "quantity", "qtyordered", "units"]);
  const emailIdx = headerIndex(headers, ["email", "backeremail", "email address"]);
  const addressIdx = headerIndex(headers, ["address", "shipto", "shipping address", "ship address", "full address"]);
  const tierIdx = headerIndex(headers, ["tier", "tiercode", "reward tier", "pledge level"]);
  const addOnIdx = headerIndex(headers, ["addons", "add-ons", "addon skus", "add on skus", "extras"]);

  if (nameIdx < 0) errors.push("Missing backer/name column");
  if (skuIdx < 0) errors.push("Missing sku/reward column");
  if (errors.length) return { source, rows: [], errors };

  const rows: CrowdfundingImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const backerName = cells[nameIdx!] ?? "";
    const rewardSku = cells[skuIdx!] ?? "";
    if (!backerName || !rewardSku) {
      errors.push(`Line ${i + 1}: missing name or sku`);
      continue;
    }
    let qty = 1;
    if (qtyIdx >= 0) {
      const raw = cells[qtyIdx] ?? "1";
      qty = Number.parseInt(raw, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push(`Line ${i + 1}: invalid qty`);
        continue;
      }
    }
    const addOnsRaw = addOnIdx >= 0 ? cells[addOnIdx] ?? "" : "";
    const addOnSkus = addOnsRaw
      ? addOnsRaw
          .split(/[|;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    rows.push({
      line: i + 1,
      backerName,
      rewardSku,
      qty,
      email: emailIdx >= 0 ? cells[emailIdx] || undefined : undefined,
      address: addressIdx >= 0 ? cells[addressIdx] || undefined : undefined,
      tierCode: tierIdx >= 0 ? cells[tierIdx] || undefined : undefined,
      addOnSkus,
    });
  }
  return { source, rows, errors };
}

export type ResolvedImportLine = { itemId: string; sku: string; qty: number };

export type ResolvedImportOrder = {
  customerName: string;
  email?: string;
  shipToAddress?: string;
  tierCode?: string;
  lines: ResolvedImportLine[];
  sourceLine: number;
};

export function resolveCrowdfundingRows(
  rows: CrowdfundingImportRow[],
  skuToItemId: Map<string, string>,
): { orders: ResolvedImportOrder[]; missingSkus: string[] } {
  const missing = new Set<string>();
  const orders: ResolvedImportOrder[] = [];
  for (const row of rows) {
    const lines: ResolvedImportLine[] = [];
    const skus = [row.rewardSku, ...(row.addOnSkus ?? [])];
    const qtyBySku = new Map<string, number>();
    for (const [index, sku] of skus.entries()) {
      const key = sku.trim();
      if (!key) continue;
      const add = index === 0 ? row.qty : 1;
      qtyBySku.set(key, (qtyBySku.get(key) ?? 0) + add);
    }
    for (const [sku, qty] of qtyBySku) {
      const itemId = skuToItemId.get(sku) ?? skuToItemId.get(sku.toUpperCase());
      if (!itemId) {
        missing.add(sku);
        continue;
      }
      lines.push({ itemId, sku, qty });
    }
    if (lines.length === 0) continue;
    orders.push({
      customerName: row.backerName,
      email: row.email,
      shipToAddress: row.address,
      tierCode: row.tierCode,
      lines,
      sourceLine: row.line,
    });
  }
  return { orders, missingSkus: [...missing].sort() };
}
