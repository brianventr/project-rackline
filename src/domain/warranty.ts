/**
 * Serial-to-warranty rules. The ledger still owns quantity. These functions only decide
 * eligibility, which serials a pack may assign, and which shipment should stamp them.
 */

export const WARRANTY_STATUSES = ["active", "expired", "void", "none"] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const RETURN_GRADES = ["a", "b", "c"] as const;
export type ReturnGrade = (typeof RETURN_GRADES)[number];

export const KLAVIYO_METRICS = {
  prepared: "Order being prepared",
  shipped: "Shipped with serial",
  returnReceived: "Return received",
} as const;

export type WarrantyView = {
  eligible: boolean;
  status: WarrantyStatus;
  start: number | null;
  end: number | null;
  termMonths: number | null;
};

export class WarrantyError extends Error {
  constructor(
    message: string,
    public code:
      | "SERIAL_COUNT"
      | "SERIAL_ASSIGNED"
      | "SERIAL_OTHER_SKU"
      | "WARRANTY"
      | "DUPLICATE_SERIAL"
      | "INTERNATIONAL",
  ) {
    super(message);
    this.name = "WarrantyError";
  }
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: "US",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  ca: "CA",
  canada: "CA",
  uk: "GB",
  gb: "GB",
  "united kingdom": "GB",
  mx: "MX",
  mexico: "MX",
};

/** ISO-ish country code. Blank stays blank so a missing address is not treated as foreign. */
export function countryCode(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase().replace(/\./g, "");
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (/^[a-z]{2}$/i.test(value.trim())) return value.trim().toUpperCase();
  return value.trim().toUpperCase();
}

/** Refuse a label when the parcel is leaving the warehouse country. EasyShip keeps those. */
export function internationalLabelBlock(
  shipToCountry: string | null | undefined,
  warehouseCountry: string | null | undefined,
): { code: "INTERNATIONAL"; error: string } | null {
  const dest = countryCode(shipToCountry);
  const origin = countryCode(warehouseCountry);
  if (!dest || !origin || dest === origin) return null;
  return {
    code: "INTERNATIONAL",
    error: `This parcel is going to ${dest}. International labels stay on EasyShip.`,
  };
}

/** Add calendar months in UTC, clamping the day so Jan 31 + 1 month is Feb 28/29. */
export function addMonthsUtc(at: number, months: number): number {
  const date = new Date(at);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

/** A blank term is not eligible. Nothing is invented in its place. */
export function warrantyFromTerm(
  shippedAt: number,
  termMonths: number | null | undefined,
  now: number,
): WarrantyView {
  if (termMonths == null || termMonths <= 0) {
    return { eligible: false, status: "none", start: null, end: null, termMonths: null };
  }
  const start = shippedAt;
  const end = addMonthsUtc(shippedAt, termMonths);
  const status: WarrantyStatus = now <= end ? "active" : "expired";
  return { eligible: status === "active", status, start, end, termMonths };
}

/**
 * The replacement keeps the original end date. Shipping the new unit does not restart the term.
 * A void or missing window stays ineligible.
 */
export function inheritWarranty(
  original: { start: number | null; end: number | null; status: string },
  now: number,
): WarrantyView {
  if (original.end == null || original.status === "none") {
    return { eligible: false, status: "none", start: original.start, end: null, termMonths: null };
  }
  const status: WarrantyStatus = now <= original.end ? "active" : "expired";
  return {
    eligible: status === "active",
    status,
    start: original.start,
    end: original.end,
    termMonths: null,
  };
}

export function normalizeSerialCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Serials scanned or typed for one pack line. An empty list on a serialized SKU waits for a later scan. */
export function serialsFromScans(
  sku: string,
  scans: { sku?: string | null; serial?: string | null; kind?: string; code?: string }[],
  soleSerialized: boolean,
): string[] {
  const out: string[] = [];
  for (const scan of scans) {
    const serial = (scan.serial || (scan.kind === "serial" ? scan.code : "") || "").trim();
    if (!serial) continue;
    if (scan.sku && scan.sku.toUpperCase() !== sku.toUpperCase()) continue;
    if (!scan.sku && !soleSerialized) continue;
    out.push(serial);
  }
  return out;
}

export function serialsForPack(input: { qty: number; trackSerial: boolean; serials: string[] }): string[] {
  const serials = input.serials.map(normalizeSerialCode).filter(Boolean);
  const seen = new Set<string>();
  for (const serial of serials) {
    if (seen.has(serial)) throw new WarrantyError(`Duplicate serial ${serial}`, "DUPLICATE_SERIAL");
    seen.add(serial);
  }
  if (!input.trackSerial) return [];
  if (serials.length === 0) return [];
  if (serials.length !== input.qty) {
    throw new WarrantyError(`Needs ${input.qty} serials, got ${serials.length}`, "SERIAL_COUNT");
  }
  return serials;
}

export type ShippedSerialLine = {
  orderId: string;
  orderNumber: string;
  lineId: string;
  sku: string;
  qty: number;
  warehouseId: string;
};

export type AssignmentFact = {
  serial: string;
  orderId: string | null;
  lineId: string | null;
};

export type ReconciliationProblem =
  | {
      kind: "missing_serial";
      orderId: string;
      orderNumber: string;
      lineId: string;
      sku: string;
      qty: number;
      assigned: number;
      warehouseId: string;
    }
  | { kind: "duplicate_serial"; serial: string; warehouseId: string | null }
  | { kind: "orphan_serial"; serial: string; warehouseId: string | null };

/** Shipped serialized units without a serial, the same serial twice, or a shipped serial with no order. */
export function reconcileSerials(input: {
  lines: ShippedSerialLine[];
  assignments: AssignmentFact[];
  shippedWithoutOrder: { serial: string; warehouseId: string | null }[];
}): ReconciliationProblem[] {
  const problems: ReconciliationProblem[] = [];
  const byLine = new Map<string, number>();
  const bySerial = new Map<string, number>();
  for (const row of input.assignments) {
    const serial = normalizeSerialCode(row.serial);
    bySerial.set(serial, (bySerial.get(serial) ?? 0) + 1);
    if (row.lineId) byLine.set(row.lineId, (byLine.get(row.lineId) ?? 0) + 1);
  }
  for (const line of input.lines) {
    const assigned = byLine.get(line.lineId) ?? 0;
    if (assigned < line.qty) {
      problems.push({ kind: "missing_serial", ...line, assigned });
    }
  }
  for (const [serial, count] of bySerial) {
    if (count > 1) problems.push({ kind: "duplicate_serial", serial, warehouseId: null });
  }
  const assignedSerials = new Set(input.assignments.map((row) => normalizeSerialCode(row.serial)));
  for (const row of input.shippedWithoutOrder) {
    const serial = normalizeSerialCode(row.serial);
    if (!assignedSerials.has(serial)) {
      problems.push({ kind: "orphan_serial", serial, warehouseId: row.warehouseId });
    }
  }
  return problems;
}

/** Refurb stock lands on the linked SKU. With no link it stays in quarantine and never joins new on-hand. */
export function refurbTarget(input: {
  disposition: string;
  itemId: string;
  refurbItemId: string | null;
}): { itemId: string; quarantine: boolean } {
  if (input.disposition !== "refurb") return { itemId: input.itemId, quarantine: false };
  if (input.refurbItemId && input.refurbItemId !== input.itemId) {
    return { itemId: input.refurbItemId, quarantine: false };
  }
  return { itemId: input.itemId, quarantine: true };
}

export function parseReturnGrade(raw: unknown): ReturnGrade | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new WarrantyError("Grade must be a, b, or c", "WARRANTY");
  const value = raw.trim().toLowerCase();
  if (!(RETURN_GRADES as readonly string[]).includes(value)) {
    throw new WarrantyError("Grade must be a, b, or c", "WARRANTY");
  }
  return value as ReturnGrade;
}

export type OpenAssignment = { id: string; packageId: string | null; shippedAt: number | null };

/** Which assignments this shipment should stamp. A partial carton only stamps its own box. */
export function assignmentIdsToStamp(
  rows: OpenAssignment[],
  input: { packageIds: string[]; orderComplete: boolean },
): string[] {
  const open = rows.filter((row) => row.shippedAt == null);
  const matched = open.filter((row) => row.packageId != null && input.packageIds.includes(row.packageId));
  if (!input.orderComplete) return matched.map((row) => row.id);
  const loose = open.filter((row) => row.packageId == null);
  return [...matched, ...loose].map((row) => row.id);
}

export function klaviyoEventBody(input: {
  metric: string;
  uniqueId: string;
  email?: string | null;
  properties: Record<string, unknown>;
}): Record<string, unknown> {
  const profile = input.email?.trim()
    ? { data: { type: "profile", attributes: { email: input.email.trim() } } }
    : undefined;
  return {
    data: {
      type: "event",
      attributes: {
        properties: input.properties,
        unique_id: input.uniqueId,
        metric: { data: { type: "metric", attributes: { name: input.metric } } },
        ...(profile ? { profile } : {}),
      },
    },
  };
}

export function shopifySerialMetafields(input: {
  orderGid: string | null;
  customerGid: string | null;
  serials: string[];
}): { ownerId: string; namespace: string; key: string; type: string; value: string }[] {
  const value = input.serials.join(", ");
  const fields = [];
  if (input.orderGid) {
    fields.push({
      ownerId: input.orderGid,
      namespace: "rackline",
      key: "serials",
      type: "single_line_text_field",
      value,
    });
  }
  if (input.customerGid) {
    fields.push({
      ownerId: input.customerGid,
      namespace: "rackline",
      key: "serials",
      type: "single_line_text_field",
      value,
    });
  }
  return fields;
}

export const SHOPIFY_METAFIELDS_SET = `#graphql
mutation RacklineSerialMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}
`;

/** The component serial printed on a kit label, when the build consumed one. */
export function kitLabelSerial(componentSerials: Array<string | null | undefined>): string | null {
  const serials = componentSerials.map((row) => (row ? normalizeSerialCode(row) : "")).filter(Boolean);
  return serials[0] ?? null;
}

export type SerialFallbackRow = { line: number; orderNumber: string; sku: string; serial: string };

/** CSV of scanned serials to reconcile later: order, sku, serial. */
export function parseSerialFallbackCsv(csv: string): { rows: SerialFallbackRow[]; errors: string[] } {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row and at least one data row"] };
  const headers = splitCsv(lines[0]!).map((cell) => cell.toLowerCase().replace(/[\s_]+/g, ""));
  const orderIdx = headers.findIndex((cell) => ["order", "ordernumber", "order number"].includes(cell) || cell === "number");
  const skuIdx = headers.findIndex((cell) => cell === "sku" || cell === "item");
  const serialIdx = headers.findIndex((cell) => cell === "serial" || cell === "serialnumber" || cell === "serials");
  if (orderIdx < 0) errors.push("Missing order column");
  if (skuIdx < 0) errors.push("Missing sku column");
  if (serialIdx < 0) errors.push("Missing serial column");
  if (errors.length) return { rows: [], errors };
  const rows: SerialFallbackRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsv(lines[i]!);
    const orderNumber = (cells[orderIdx] ?? "").trim();
    const sku = (cells[skuIdx] ?? "").trim();
    const serial = normalizeSerialCode(cells[serialIdx] ?? "");
    if (!orderNumber || !sku || !serial) {
      errors.push(`Line ${i + 1}: missing order, sku, or serial`);
      continue;
    }
    if (seen.has(serial)) {
      errors.push(`Line ${i + 1}: duplicate serial ${serial}`);
      continue;
    }
    seen.add(serial);
    rows.push({ line: i + 1, orderNumber, sku: sku.toUpperCase(), serial });
  }
  return { rows, errors };
}

export function serialFallbackCsv(rows: { orderNumber: string; sku: string; qty: number; assigned: number }[]): string {
  const lines = ["order,sku,qty,assigned,serial"];
  for (const row of rows) {
    const needed = Math.max(0, row.qty - row.assigned);
    for (let i = 0; i < needed; i++) lines.push(`${csvCell(row.orderNumber)},${csvCell(row.sku)},${row.qty},${row.assigned},`);
    if (needed === 0) lines.push(`${csvCell(row.orderNumber)},${csvCell(row.sku)},${row.qty},${row.assigned},`);
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function splitCsv(line: string): string[] {
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
