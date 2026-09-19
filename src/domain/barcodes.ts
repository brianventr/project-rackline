export type ScanKind =
  | "location"
  | "item"
  | "order"
  | "receipt"
  | "transfer"
  | "workOrder"
  | "cycleCount"
  | "unknown";

export type ParsedScan = {
  kind: ScanKind;
  value: string;
  raw: string;
};

const PREFIXES: Array<{ prefix: string; kind: Exclude<ScanKind, "unknown"> }> = [
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
];

export function normalizeBarcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseScan(raw: string): ParsedScan {
  const value = normalizeBarcode(raw);
  for (const entry of PREFIXES) {
    if (value.startsWith(entry.prefix)) {
      return { kind: entry.kind, value: value.slice(entry.prefix.length), raw: value };
    }
  }
  return { kind: "unknown", value, raw: value };
}

export function documentPath(kind: Exclude<ScanKind, "unknown" | "location" | "item">, id: string): string {
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
  }
}
