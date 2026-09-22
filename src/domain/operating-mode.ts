export const OPERATING_MODES = ["garage", "warehouse"] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export const GARAGE_MODE_LABEL = "Garage Mode";

export function parseOperatingMode(value: unknown): OperatingMode {
  if (value === "garage" || value === "warehouse") return value;
  throw new Error("Operating mode must be garage or warehouse");
}

export function isGarageMode(mode: string | null | undefined): boolean {
  return mode === "garage";
}

/** Office and floor routes a founder bench can open. Query strings are ignored. */
const GARAGE_PATHS: { prefix: string; exact?: boolean }[] = [
  { prefix: "/today", exact: true },
  { prefix: "/live", exact: true },
  { prefix: "/dashboard", exact: true },
  { prefix: "/floor", exact: true },
  { prefix: "/floor/lookup" },
  { prefix: "/floor/print" },
  { prefix: "/floor/receive" },
  { prefix: "/floor/putaway" },
  { prefix: "/floor/pick" },
  { prefix: "/floor/pack" },
  { prefix: "/floor/ship" },
  { prefix: "/floor/return" },
  { prefix: "/floor/assemble" },
  { prefix: "/floor/kit" },
  { prefix: "/floor/adjust" },
  { prefix: "/map" },
  { prefix: "/move", exact: true },
  { prefix: "/analytics/runway" },
  { prefix: "/stock", exact: true },
  { prefix: "/stock/items" },
  { prefix: "/stock/locations" },
  { prefix: "/stock/ledger" },
  { prefix: "/inventory", exact: true },
  { prefix: "/items" },
  { prefix: "/locations" },
  { prefix: "/ledger", exact: true },
  { prefix: "/make" },
  { prefix: "/boms" },
  { prefix: "/work-orders" },
  { prefix: "/inbound/receipts" },
  { prefix: "/receipts" },
  { prefix: "/inbound/purchases" },
  { prefix: "/inbound/putaway" },
  { prefix: "/transfers" },
  { prefix: "/outbound/orders" },
  { prefix: "/orders" },
  { prefix: "/outbound/returns" },
  { prefix: "/setup/integrations" },
  { prefix: "/setup/shopify" },
  { prefix: "/setup/carriers" },
  { prefix: "/setup/warehouse" },
  { prefix: "/setup/team" },
  { prefix: "/setup/audit" },
  { prefix: "/setup/labels" },
  { prefix: "/shopify" },
  { prefix: "/adjustments", exact: true },
];

export function pathOnly(path: string): string {
  const bare = path.split("?")[0]?.split("#")[0] ?? "/";
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare || "/";
}

export function garageAllowsPath(path: string): boolean {
  const bare = pathOnly(path);
  return GARAGE_PATHS.some((entry) =>
    entry.exact ? bare === entry.prefix : bare === entry.prefix || bare.startsWith(`${entry.prefix}/`),
  );
}
