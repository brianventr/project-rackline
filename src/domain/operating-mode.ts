export const OPERATING_MODES = ["garage", "warehouse"] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export const GARAGE_MODE_LABEL = "Garage Mode";

export const MANUFACTURER_MODE_LABEL = "Manufacturer";

export const GARAGE_SWITCH_LABEL = "Garage";

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

export type GarageNavItem = { title: string; url: string };

export type GarageNavGroup = { label: string; ownerOnly?: boolean; items: GarageNavItem[] };

/** Short maker menu. Ledger, office putaway, and audit stay open by direct link. */
export const GARAGE_NAV: GarageNavGroup[] = [
  {
    label: "Bench",
    items: [
      { title: "Today", url: "/today" },
      { title: "Floor", url: "/floor" },
      { title: "Shelf map", url: "/map" },
    ],
  },
  {
    label: "Parts",
    items: [
      { title: "Buy parts", url: "/inbound/purchases" },
      { title: "Receive", url: "/inbound/receipts" },
    ],
  },
  {
    label: "Build",
    items: [
      { title: "Recipes", url: "/make/recipes" },
      { title: "Builds", url: "/make/work-orders" },
      { title: "Kits", url: "/make/kits" },
    ],
  },
  {
    label: "Ship",
    items: [
      { title: "Orders", url: "/outbound/orders" },
      { title: "Returns", url: "/outbound/returns" },
    ],
  },
  {
    label: "Shelf",
    items: [
      { title: "On hand", url: "/stock" },
      { title: "Items", url: "/stock/items" },
    ],
  },
  {
    label: "Runway",
    items: [{ title: "Runway", url: "/analytics/runway" }],
  },
  {
    label: "Shop",
    ownerOnly: true,
    items: [
      { title: "Shopify", url: "/setup/shopify" },
      { title: "Carriers", url: "/setup/carriers" },
      { title: "Team", url: "/setup/team" },
      { title: "Printers", url: "/setup/labels" },
      { title: "Bench setup", url: "/setup/warehouse" },
    ],
  },
];

export function garageNavForRole(role: string | null | undefined): GarageNavGroup[] {
  const owner = role === "owner";
  return GARAGE_NAV.filter((group) => owner || !group.ownerOnly);
}
