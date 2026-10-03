/**
 * Owner sees the whole shop. Operator runs the floor and the office, without setup deletes.
 * Picker lands on Next job and does not open cost, vendors, or runway.
 * Bookkeeper sees cost and purchases, and does not run the floor.
 */

export const ROLES = ["owner", "operator", "picker", "bookkeeper"] as const;
export type AppRole = (typeof ROLES)[number];

export function isAppRole(value: string): value is AppRole {
  return (ROLES as readonly string[]).includes(value);
}

const PICKER_DENIED = [
  "/api/analytics",
  "/api/vendors",
  "/api/accounting",
  "/api/team",
  "/api/billing",
  "/api/clients",
  "/api/labor",
  "/api/automation",
  "/api/live",
  "/api/edi",
  "/api/equipment",
  "/api/integrations",
];

const BOOKKEEPER_WRITES = ["/api/accounting", "/api/purchases", "/api/vendors", "/api/items"];

function barePath(path: string): string {
  return path.split("?")[0]?.split("#")[0] ?? path;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True when this role must not call this route. Owners and operators keep the routes they already have. */
export function requestDenied(role: string | null | undefined, method: string, path: string): boolean {
  const bare = barePath(path);
  if (!bare.startsWith("/api/")) return false;
  if (role === "picker") return PICKER_DENIED.some((prefix) => under(bare, prefix));
  if (role === "bookkeeper") {
    if (under(bare, "/api/floor") || under(bare, "/api/jobs")) return true;
    if (under(bare, "/api/ship") && method !== "GET" && method !== "HEAD") return true;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
    return !BOOKKEEPER_WRITES.some((prefix) => under(bare, prefix));
  }
  return false;
}

/** Where a picker or bookkeeper is sent when they open a page that is not theirs. */
export function rolePageRedirect(role: string | null | undefined, path: string): string | null {
  const bare = barePath(path);
  if (role === "picker") return bare === "/floor" || bare.startsWith("/floor/") ? null : "/floor";
  if (role === "bookkeeper") {
    const allowed =
      bare === "/stock" ||
      bare.startsWith("/stock/items") ||
      bare.startsWith("/inbound/purchases") ||
      bare.startsWith("/inbound/vendors") ||
      bare.startsWith("/setup/accounting");
    return allowed ? null : "/setup/accounting";
  }
  return null;
}

export const PICKER_NAV = [{ label: "Floor", items: [{ title: "Next job", url: "/floor" }] }] as const;

export const BOOKKEEPER_NAV = [
  {
    label: "Books",
    items: [
      { title: "Purchases", url: "/inbound/purchases" },
      { title: "Vendors", url: "/inbound/vendors" },
      { title: "Items", url: "/stock/items" },
      { title: "On hand", url: "/stock" },
      { title: "Accounting", url: "/setup/accounting" },
    ],
  },
] as const;
