export type EdiAsnPayload = {
  warehouseId: string;
  vendorName: string;
  clientCode?: string | null;
  reference?: string | null;
  lines: { sku: string; qty: number }[];
};

export class EdiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdiParseError";
  }
}

export function parseEdiAsnBody(body: unknown): EdiAsnPayload {
  if (!body || typeof body !== "object") throw new EdiParseError("Body must be an object");
  const row = body as Record<string, unknown>;
  const warehouseId = typeof row.warehouseId === "string" ? row.warehouseId.trim() : "";
  const vendorName = typeof row.vendorName === "string" ? row.vendorName.trim() : "";
  if (!warehouseId) throw new EdiParseError("warehouseId is required");
  if (!vendorName) throw new EdiParseError("vendorName is required");
  if (!Array.isArray(row.lines) || row.lines.length === 0) {
    throw new EdiParseError("At least one line is required");
  }
  const lines: { sku: string; qty: number }[] = [];
  const seen = new Set<string>();
  for (const line of row.lines) {
    if (!line || typeof line !== "object") throw new EdiParseError("Invalid line");
    const l = line as Record<string, unknown>;
    const sku = typeof l.sku === "string" ? l.sku.trim().toUpperCase() : "";
    const qty = l.qty;
    if (!sku) throw new EdiParseError("Line sku is required");
    if (!Number.isInteger(qty) || (qty as number) <= 0) throw new EdiParseError("Line qty must be positive");
    if (seen.has(sku)) throw new EdiParseError("Duplicate SKU on ASN");
    seen.add(sku);
    lines.push({ sku, qty: qty as number });
  }
  const clientCode =
    typeof row.clientCode === "string" && row.clientCode.trim() ? row.clientCode.trim().toUpperCase() : null;
  const reference = typeof row.reference === "string" && row.reference.trim() ? row.reference.trim() : null;
  return { warehouseId, vendorName, clientCode, reference, lines };
}
