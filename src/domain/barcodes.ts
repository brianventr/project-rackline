export type ScanKind =
  | "location"
  | "item"
  | "order"
  | "receipt"
  | "transfer"
  | "workOrder"
  | "cycleCount"
  | "purchase"
  | "rma"
  | "vendorReturn"
  | "replenishment"
  | "kit"
  | "hold"
  | "wave"
  | "asn"
  | "package"
  | "yard"
  | "equipment"
  | "serial"
  | "lot"
  | "unknown";

export type Gs1Fields = {
  gtin?: string;
  lot?: string;
  serial?: string;
};

export type ParsedScan = {
  kind: ScanKind;
  value: string;
  raw: string;
  gs1?: Gs1Fields;
};

export const PREFIXES: Array<{ prefix: string; kind: Exclude<ScanKind, "unknown"> }> = [
  { prefix: "LOC:", kind: "location" },
  { prefix: "BIN:", kind: "location" },
  { prefix: "BAY:", kind: "location" },
  { prefix: "SKU:", kind: "item" },
  { prefix: "ITEM:", kind: "item" },
  { prefix: "ORD:", kind: "order" },
  { prefix: "SO:", kind: "order" },
  { prefix: "RCP:", kind: "receipt" },
  { prefix: "RCV:", kind: "receipt" },
  { prefix: "XFR:", kind: "transfer" },
  { prefix: "TRN:", kind: "transfer" },
  { prefix: "WO:", kind: "workOrder" },
  { prefix: "CC:", kind: "cycleCount" },
  { prefix: "PO:", kind: "purchase" },
  { prefix: "PUR:", kind: "purchase" },
  { prefix: "RMA:", kind: "rma" },
  { prefix: "RET:", kind: "rma" },
  { prefix: "RTV:", kind: "vendorReturn" },
  { prefix: "VRT:", kind: "vendorReturn" },
  { prefix: "RPL:", kind: "replenishment" },
  { prefix: "KIT:", kind: "kit" },
  { prefix: "HLD:", kind: "hold" },
  { prefix: "WAV:", kind: "wave" },
  { prefix: "ASN:", kind: "asn" },
  { prefix: "BOX:", kind: "package" },
  { prefix: "SSCC:", kind: "package" },
  { prefix: "YRD:", kind: "yard" },
  { prefix: "EQ:", kind: "equipment" },
  { prefix: "SN:", kind: "serial" },
  { prefix: "SER:", kind: "serial" },
  { prefix: "SERIAL:", kind: "serial" },
  { prefix: "LOT:", kind: "lot" },
];

export const SCAN_PREFIX_CHEATSHEET = [
  "LOC:",
  "BIN:",
  "BAY:",
  "SKU:",
  "ITEM:",
  "ORD:",
  "SO:",
  "RCP:",
  "RCV:",
  "XFR:",
  "TRN:",
  "WO:",
  "CC:",
  "PO:",
  "PUR:",
  "RMA:",
  "RET:",
  "RTV:",
  "VRT:",
  "RPL:",
  "KIT:",
  "HLD:",
  "WAV:",
  "ASN:",
  "BOX:",
  "SSCC:",
  "YRD:",
  "SN:",
  "SER:",
  "LOT:",
  "EQ:",
] as const;

export function normalizeBarcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Light GS1 AI parse for (01) GTIN, (10) lot, (21) serial. */
export function parseGs1(raw: string): Gs1Fields | null {
  const cleaned = raw.trim().replace(/[()]/g, "").toUpperCase();
  if (!cleaned) return null;

  const fields: Gs1Fields = {};
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned.startsWith("01", i) && cleaned.length - i >= 16) {
      fields.gtin = cleaned.slice(i + 2, i + 16);
      i += 16;
      continue;
    }
    if (cleaned.startsWith("10", i)) {
      i += 2;
      let end = i;
      while (end < cleaned.length && !isAiStart(cleaned, end)) end += 1;
      fields.lot = cleaned.slice(i, end);
      i = end;
      continue;
    }
    if (cleaned.startsWith("21", i)) {
      i += 2;
      let end = i;
      while (end < cleaned.length && !isAiStart(cleaned, end)) end += 1;
      fields.serial = cleaned.slice(i, end);
      i = end;
      continue;
    }
    break;
  }

  if (!fields.gtin && !fields.lot && !fields.serial) return null;
  return fields;
}

function isAiStart(value: string, index: number): boolean {
  return (
    (value.startsWith("01", index) && value.length - index >= 16) ||
    value.startsWith("10", index) ||
    value.startsWith("21", index)
  );
}

export function parseScan(raw: string): ParsedScan {
  const value = normalizeBarcode(raw);
  for (const entry of PREFIXES) {
    if (value.startsWith(entry.prefix)) {
      return { kind: entry.kind, value: value.slice(entry.prefix.length), raw: value };
    }
  }

  const gs1 = parseGs1(raw);
  if (gs1?.gtin) {
    return { kind: "item", value: gs1.gtin, raw: value, gs1 };
  }
  if (gs1?.serial) {
    return { kind: "serial", value: gs1.serial, raw: value, gs1 };
  }
  if (gs1?.lot) {
    return { kind: "lot", value: gs1.lot, raw: value, gs1 };
  }

  return { kind: "unknown", value, raw: value, gs1: gs1 ?? undefined };
}

export function documentPath(kind: Exclude<ScanKind, "unknown" | "location" | "item" | "serial" | "lot">, id: string): string {
  switch (kind) {
    case "order":
      return `/outbound/orders/${id}`;
    case "receipt":
      return `/inbound/receipts/${id}`;
    case "transfer":
      return `/inbound/putaway/${id}`;
    case "workOrder":
      return `/make/work-orders/${id}`;
    case "cycleCount":
      return `/stock/counts/${id}`;
    case "purchase":
      return `/inbound/purchases/${id}`;
    case "rma":
      return `/outbound/returns/${id}`;
    case "vendorReturn":
      return `/inbound/vendor-returns/${id}`;
    case "replenishment":
      return `/stock/replenish/${id}`;
    case "kit":
      return `/make/kits/${id}`;
    case "hold":
      return `/stock/holds/${id}`;
    case "wave":
      return `/outbound/waves/${id}`;
    case "asn":
      return `/inbound/asns/${id}`;
    case "package":
      return `/inbound/asns/${id}`;
    case "yard":
      return `/inbound/yard/${id}`;
    case "equipment":
      return `/equipment/${id}`;
  }
}
