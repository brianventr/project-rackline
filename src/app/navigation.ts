import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  BoxSelect,
  Boxes,
  Building2,
  Calculator,
  ClipboardList,
  Clock,
  Contact,
  Container,
  Factory,
  FileInput,
  Forklift,
  Gauge,
  Grid3x3,
  Hammer,
  Hourglass,
  Inbox,
  LayoutDashboard,
  ListTree,
  Lock,
  Map,
  MapPin,
  Package,
  Package2,
  PackagePlus,
  Plug,
  Printer,
  Radar,
  Receipt,
  ScanLine,
  ScrollText,
  Settings,
  Shield,
  ShoppingCart,
  Split,
  Store,
  Truck,
  Undo2,
  Users,
  Waves,
  Workflow,
  Puzzle,
  FileCode2,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Dashboard } from "./api";
import type { ExceptionCounts } from "@/domain/exceptions/inbox";
import { garageAllowsPath, garageNavForRole } from "@/domain/operating-mode";
import { BOOKKEEPER_NAV, PICKER_NAV, SUPPORT_NAV, VIEWER_NAV } from "@/domain/roles";

export type NavCount = { value: number; tone?: "default" | "warning" };

/** What sidebar badges read: the shared dashboard counts, plus the exception inbox's once it loads. */
export type NavCounts = Dashboard & { exceptions?: ExceptionCounts };

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords?: string;
  ownerOnly?: boolean;
  /** Open-work badge read from the shared dashboard counts. */
  count?: (counts: NavCounts) => NavCount | null;
};

export type NavGroup = { label: string; items: NavItem[] };

function n(value: number | undefined | null, tone: NavCount["tone"] = "default"): NavCount | null {
  return value ? { value, tone } : null;
}

export const SETTINGS_ITEMS: NavItem[] = [
  { title: "Integrations", url: "/setup/integrations", icon: Plug, keywords: "connect apps" },
  { title: "Shopify", url: "/setup/shopify", icon: Store, keywords: "store checkout channel stocky" },
  { title: "Channels", url: "/setup/channels", icon: Store, keywords: "etsy faire marketplace csv" },
  { title: "Imports", url: "/setup/imports", icon: FileInput, keywords: "backerkit kickstarter gamefound crowdfunding csv" },
  { title: "Accounting", url: "/setup/accounting", icon: Calculator, keywords: "qbo xero cogs valuation export" },
  { title: "Carriers", url: "/setup/carriers", icon: Truck, keywords: "ups fedex usps dhl easypost shipengine postage" },
  {
    title: "Shipping rules",
    url: "/setup/shipping-rules",
    icon: Split,
    keywords: "ship rules box service cheapest fastest hold review automation",
  },
  { title: "Warehouse", url: "/setup/warehouse", icon: Warehouse, keywords: "building garage mode timezone bench default carrier service" },
  { title: "Team", url: "/setup/team", icon: Users, keywords: "people invite operators roles certs" },
  { title: "Clients", url: "/setup/clients", icon: Building2, keywords: "3pl customers portal" },
  { title: "Zones", url: "/setup/zones", icon: Grid3x3, keywords: "aisles areas" },
  { title: "Printers", url: "/setup/labels", icon: Printer, keywords: "labels zpl print station" },
  { title: "Billing", url: "/setup/billing", icon: Receipt, keywords: "invoice 3pl rates" },
  { title: "EDI", url: "/setup/edi", icon: FileCode2, keywords: "asn inbox supplier" },
  { title: "Audit", url: "/setup/audit", icon: Shield, keywords: "log history changes" },
];

const SETTINGS_ENTRY: NavItem = {
  title: "Settings",
  url: "/setup",
  icon: Settings,
  ownerOnly: true,
  keywords: "setup configuration",
};

export const OFFICE_NAV: NavGroup[] = [
  {
    label: "Today",
    items: [
      { title: "Today", url: "/today", icon: LayoutDashboard, keywords: "home dashboard dispatch" },
      {
        title: "Automation",
        url: "/automation",
        icon: Workflow,
        ownerOnly: true,
        keywords: "replenish alert reminder flow workflow auto queue",
      },
      {
        title: "Exceptions",
        url: "/exceptions",
        icon: AlertTriangle,
        keywords: "problems needs attention failed stuck held variance claim snooze resolve inbox",
        count: (d) => n(d.exceptions?.open, d.exceptions?.blocking ? "warning" : "default"),
      },
      { title: "Live", url: "/live", icon: Activity, ownerOnly: true, keywords: "wall pace" },
      { title: "Performance", url: "/labor", icon: Gauge, ownerOnly: true, keywords: "labor kpi staff" },
      { title: "Floor", url: "/floor", icon: ScanLine, keywords: "scan handheld jobs" },
      { title: "Map", url: "/map", icon: Map, keywords: "racks bays 3d" },
      {
        title: "Equipment",
        url: "/equipment",
        icon: Forklift,
        keywords: "forklift pallet jack",
        count: (d) => n(d.outOfService, "warning"),
      },
      { title: "Build floor", url: "/map?edit=1", icon: BoxSelect, ownerOnly: true, keywords: "layout racks editor" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Traffic", url: "/analytics/traffic", icon: Radar, keywords: "shipments map tracker" },
      { title: "Runway", url: "/analytics/runway", icon: Hourglass, keywords: "stockout days of cover" },
      { title: "Restock", url: "/analytics/restock", icon: PackagePlus, keywords: "reorder forecast make transit ocean order by" },
      { title: "Promise", url: "/analytics/promise", icon: Clock, keywords: "leave by pickup cutoff quote ship date" },
      { title: "Recall", url: "/analytics/recall", icon: Shield, keywords: "lot serial genealogy food beauty" },
    ],
  },
  {
    label: "Inbound",
    items: [
      { title: "Receipts", url: "/inbound/receipts", icon: Inbox, count: (d) => n(d.openReceipts) },
      { title: "ASNs", url: "/inbound/asns", icon: FileInput, keywords: "advance ship notice", count: (d) => n(d.openAsns) },
      { title: "Yard", url: "/inbound/yard", icon: Container, keywords: "trailer dock", count: (d) => n(d.openYard) },
      {
        title: "Putaway",
        url: "/inbound/putaway",
        icon: ArrowRightLeft,
        keywords: "transfer move",
        count: (d) => n(d.openTransfers + (d.putawayDue ?? 0)),
      },
      { title: "Purchases", url: "/inbound/purchases", icon: ShoppingCart, keywords: "po vendor buy", count: (d) => n(d.openPurchases) },
      { title: "Vendors", url: "/inbound/vendors", icon: Factory, keywords: "supplier lead time terms cost" },
      {
        title: "Vendor returns",
        url: "/inbound/vendor-returns",
        icon: ArrowUpFromLine,
        keywords: "rtv",
        count: (d) => n(d.openVendorReturns),
      },
    ],
  },
  {
    label: "Stock",
    items: [
      { title: "On hand", url: "/stock", icon: Boxes, keywords: "inventory atp" },
      { title: "Items", url: "/stock/items", icon: Package, keywords: "sku catalog products" },
      { title: "Locations", url: "/stock/locations", icon: MapPin, keywords: "bays bins" },
      { title: "Plates", url: "/stock/plates", icon: Package2, keywords: "license plate lpn tote pallet carton" },
      { title: "Counts", url: "/stock/counts", icon: Calculator, keywords: "cycle count", count: (d) => n(d.openCycleCounts) },
      { title: "Holds", url: "/stock/holds", icon: Lock, keywords: "qc quarantine lock", count: (d) => n(d.openHolds, "warning") },
      {
        title: "Replenish",
        url: "/stock/replenish",
        icon: ArrowDownToLine,
        keywords: "pick face",
        count: (d) => n((d.openReplenishments ?? 0) + (d.replenishDue ?? 0)),
      },
      { title: "Ledger", url: "/stock/ledger", icon: ScrollText, keywords: "movements history" },
    ],
  },
  {
    label: "Make",
    items: [
      { title: "Recipes", url: "/make/recipes", icon: ListTree, keywords: "bom bill of materials" },
      { title: "Schedule", url: "/make/schedule", icon: ClipboardList, keywords: "production board kits work orders" },
      { title: "Work orders", url: "/make/work-orders", icon: Hammer, keywords: "assemble build", count: (d) => n(d.openWorkOrders) },
      { title: "Kits", url: "/make/kits", icon: Puzzle, keywords: "kitting", count: (d) => n(d.openKits) },
    ],
  },
  {
    label: "Outbound",
    items: [
      { title: "Orders", url: "/outbound/orders", icon: ClipboardList, keywords: "pick pack ship", count: (d) => n(d.openOrders) },
      { title: "Customers", url: "/outbound/customers", icon: Contact, keywords: "buyer ship to address email" },
      { title: "Waves", url: "/outbound/waves", icon: Waves, keywords: "batch", count: (d) => n(d.openWaves) },
      { title: "Returns", url: "/outbound/returns", icon: Undo2, keywords: "rma customer", count: (d) => n(d.openReturns) },
    ],
  },
];

const ICON_BY_URL: Record<string, LucideIcon> = Object.fromEntries(
  [...OFFICE_NAV.flatMap((group) => group.items), ...SETTINGS_ITEMS].map((item) => [item.url, item.icon]),
);
const COUNT_BY_URL: Record<string, NavItem["count"]> = Object.fromEntries(
  OFFICE_NAV.flatMap((group) => group.items)
    .filter((item) => item.count)
    .map((item) => [item.url, item.count]),
);

/** Sidebar groups for this person. Garage Mode keeps its shorter bench menu; Setup folds into one Settings entry. */
function namedNav(groups: readonly { label: string; items: readonly { title: string; url: string }[] }[]): NavGroup[] {
  return groups.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      title: item.title,
      url: item.url,
      icon: ICON_BY_URL[item.url] ?? LayoutDashboard,
      count: COUNT_BY_URL[item.url],
    })),
  }));
}

export function navForSession(role: string, garage: boolean, options?: { setupComplete?: boolean }): NavGroup[] {
  if (role === "picker") return namedNav(PICKER_NAV);
  if (role === "bookkeeper") return namedNav(BOOKKEEPER_NAV);
  if (role === "viewer") return namedNav(VIEWER_NAV);
  if (role === "support") return namedNav(SUPPORT_NAV);
  const owner = role === "owner";
  if (garage) {
    const groups = garageNavForRole(role, options)
      .filter((group) => !group.ownerOnly)
      .map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({
          title: item.title,
          url: item.url,
          icon: ICON_BY_URL[item.url] ?? LayoutDashboard,
          count: COUNT_BY_URL[item.url],
        })),
      }));
    return owner ? [...groups, { label: "Shop", items: [SETTINGS_ENTRY] }] : groups;
  }
  const groups = OFFICE_NAV.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => owner || !item.ownerOnly),
  })).filter((group) => group.items.length);
  return owner ? [...groups, { label: "Setup", items: [SETTINGS_ENTRY] }] : groups;
}

/** Settings pages this person can open, in sub-nav order. */
export function settingsForSession(role: string, garage: boolean): NavItem[] {
  if (role === "bookkeeper") return SETTINGS_ITEMS.filter((item) => item.url === "/setup/accounting");
  if (role !== "owner") return [];
  return SETTINGS_ITEMS.filter((item) => !garage || garageAllowsPath(item.url));
}

/**
 * Every destination for the command palette's Go to group.
 * Garage's first hour shortens the sidebar only. Recipes, Restock, Promise, and shipping rules stay one search away.
 */
export function destinationsForSession(role: string, garage: boolean): NavItem[] {
  const pages = navForSession(role, garage, { setupComplete: true }).flatMap((group) =>
    group.items.filter((item) => item.url !== "/setup"),
  );
  const seen = new Set(pages.map((item) => item.url));
  return [...pages, ...settingsForSession(role, garage).filter((item) => !seen.has(item.url))];
}

export function isNavActive(pathname: string, search: string, url: string): boolean {
  const [path, query] = url.split("?");
  if (query) return pathname === path && search.includes(query);
  if (path === "/stock") return pathname === "/stock";
  if (path === "/map") return pathname === "/map" && !search.includes("edit=1");
  return pathname === path || pathname.startsWith(`${path}/`);
}
