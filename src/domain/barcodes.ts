export type ScanKind = "location" | "item" | "unknown";

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
