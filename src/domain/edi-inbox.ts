/**
 * Reading and writing the `payloadJson` kept on each EDI inbox row. Processed rows hold the
 * normalized ASN; refused rows hold what the supplier sent, which can be any JSON at all.
 */

/** Lines echoed per inbox row for chips and SKU search; `lineCount` still counts them all. */
export const EDI_INBOX_LINES = 50;

/** A refused body is kept as sent up to this many characters, then only its headline fields. */
export const REFUSED_PAYLOAD_MAX = 32_000;

/**
 * Longest vendor name, reference or SKU the inbox echoes. A refused body is stored as sent, so these
 * can be as long as the whole body; the inbox cuts them here with an ellipsis.
 */
export const EDI_INBOX_TEXT_MAX = 200;

/**
 * Refused rows kept per org. Older ones are dropped as new ones land, so a supplier retrying a bad
 * ASN cannot grow the table without bound or push processed ASNs out of the inbox (which reads
 * the newest 200 rows).
 */
export const FAILED_INBOX_KEEP = 100;

export type EdiInboxLine = { sku: string; qty: number };

export type EdiInboxPayloadSummary = {
  vendorName: string | null;
  reference: string | null;
  /** Entries in the `lines` array as sent, readable or not; from the stub when the body was too big to keep. */
  lineCount: number;
  /** The first `EDI_INBOX_LINES` entries that name a SKU. */
  lines: EdiInboxLine[];
};

/** What a too-big refused body is stored as. `summarizeEdiPayload` trusts `lineCount` only on this shape. */
export type TruncatedEdiPayload = {
  truncated: true;
  vendorName: string | null;
  reference: string | null;
  lineCount: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Trimmed text cut to `EDI_INBOX_TEXT_MAX` characters (the last one an ellipsis), or null when blank or not a string. */
export function clipInboxText(value: unknown): string | null {
  const kept = text(value);
  if (!kept || kept.length <= EDI_INBOX_TEXT_MAX) return kept;
  return `${kept.slice(0, EDI_INBOX_TEXT_MAX - 1).trimEnd()}…`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A number, or a string that is one. Anything else (true, null, "12 cases", [5]) reads as 0. */
function lineQty(value: unknown): number {
  const qty = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(qty) ? qty : 0;
}

/** Reads what a stored payload says without trusting its shape: refused payloads are kept as sent. */
export function summarizeEdiPayload(payloadJson: string | null | undefined): EdiInboxPayloadSummary {
  let parsed: unknown = null;
  if (payloadJson) {
    try {
      parsed = JSON.parse(payloadJson);
    } catch {
      parsed = null;
    }
  }
  const row = asObject(parsed) ?? {};
  const rawLines: unknown[] = Array.isArray(row.lines) ? row.lines : [];
  const lines: EdiInboxLine[] = [];
  for (const line of rawLines) {
    if (lines.length >= EDI_INBOX_LINES) break;
    const entry = asObject(line);
    const sku = entry ? clipInboxText(entry.sku) : null;
    if (!entry || !sku) continue;
    lines.push({ sku: sku.toUpperCase(), qty: lineQty(entry.qty) });
  }
  // Only the stub we write for an oversized body carries a count of its own. A supplier's
  // top-level `lineCount` is just another field they sent, so the real array wins.
  const storedCount =
    row.truncated === true && typeof row.lineCount === "number" && Number.isInteger(row.lineCount) && row.lineCount >= 0
      ? row.lineCount
      : null;
  return {
    vendorName: clipInboxText(row.vendorName),
    reference: clipInboxText(row.reference),
    lineCount: storedCount ?? rawLines.length,
    lines,
  };
}

/** The body a refused ASN is stored with: as sent, or a `TruncatedEdiPayload` stub when it is too large to keep. */
export function refusedPayloadJson(raw: unknown): string {
  let full: string;
  try {
    full = JSON.stringify(raw ?? null) ?? "null";
  } catch {
    full = "null";
  }
  if (full.length <= REFUSED_PAYLOAD_MAX) return full;
  const row = asObject(raw) ?? {};
  const stub: TruncatedEdiPayload = {
    truncated: true,
    vendorName: clipInboxText(row.vendorName),
    reference: clipInboxText(row.reference),
    lineCount: Array.isArray(row.lines) ? row.lines.length : 0,
  };
  return JSON.stringify(stub);
}
