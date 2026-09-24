/**
 * The system hierarchy a new person has to hold in their head, in three questions:
 *
 * - Where does stock sit?  organization → warehouse → area → aisle / rack / bay / level → bin
 * - What is there?         SKU → on hand (one SKU in one bin) → overlays (lots, serials, holds…)
 * - How does it move?      document → movement on the ledger → floor job
 *
 * Pure data and helpers so the tour, the setup wizard, and Locations all draw the same picture.
 */
import { garageAllowsPath } from "./operating-mode";
import { addressLabel, areaForType } from "./map-layout";
import { normalizeAisle, normalizeRack, padBay } from "./rack-builder";

export type HierarchyGroupId = "where" | "what" | "how";

export type HierarchyLevelId =
  | "organization"
  | "warehouse"
  | "area"
  | "aisle"
  | "rack"
  | "bay"
  | "level"
  | "bin"
  | "sku"
  | "on-hand"
  | "overlay"
  | "document"
  | "movement"
  | "job";

export type HierarchyGroup = {
  id: HierarchyGroupId;
  title: string;
  /** The question this part of the tree answers. */
  question: string;
};

export type HierarchyLevel = {
  id: HierarchyLevelId;
  group: HierarchyGroupId;
  title: string;
  /** One sentence: what it is. */
  short: string;
  /** How Rackline treats it. */
  long: string;
  /** A concrete value, shown monospace. */
  example: string;
  /** Glossary id with the fuller definition, when one exists. */
  term?: string;
  /** The page that shows it best, when there is one. */
  path?: string;
};

export const HIERARCHY_GROUPS: readonly HierarchyGroup[] = [
  { id: "where", title: "Where stock sits", question: "Where is it?" },
  { id: "what", title: "What is there", question: "What is it?" },
  { id: "how", title: "How it moves", question: "How did it get there?" },
];

/** Top to bottom. The where-group is the address of a bin, read left to right in its code. */
export const HIERARCHY_LEVELS: readonly HierarchyLevel[] = [
  {
    id: "organization",
    group: "where",
    title: "Organization",
    short: "Your company or shop: one sign-in, one catalog of SKUs, one ledger.",
    long: "Owners see the office and Settings. Operators land on the floor with the verbs they are given. Garage Mode or Manufacturer is set once for the whole organization.",
    example: "Northwind Makers",
    path: "/setup/team",
  },
  {
    id: "warehouse",
    group: "where",
    title: "Warehouse",
    short: "A building with its own map, timezone, and ship-from address. Every bin belongs to one.",
    long: "Garage Mode has one building. Manufacturer can add more and move stock between them. The switcher in the top bar picks the one you are looking at.",
    example: "Main warehouse",
    path: "/setup/warehouse",
  },
  {
    id: "area",
    group: "where",
    title: "Area",
    short: "A region of the floor: the dock where stock arrives, aisles of storage, the bench where things are built, and outbound where orders leave.",
    long: "The area follows the bin's type: receiving, storage, production, or shipping. In Manufacturer, zones group bays so a wave can be scoped to one.",
    example: "Dock · Aisle A · Shop · Outbound",
    term: "dock",
    path: "/map",
  },
  {
    id: "aisle",
    group: "where",
    title: "Aisle",
    short: "A lettered row you walk down, with racks on it.",
    long: "The first part of a storage code. Pick lists walk aisle, then rack, then bay, then level.",
    example: "A",
    path: "/map",
  },
  {
    id: "rack",
    group: "where",
    title: "Rack",
    short: "A numbered run of shelving in an aisle. Build floor adds a whole rack at once.",
    long: "The second part of a storage code. Racks are numbered from 01 along the aisle.",
    example: "01",
    path: "/map",
  },
  {
    id: "bay",
    group: "where",
    title: "Bay",
    short: "One shelf-width of a rack, numbered from 01 at the start of each rack.",
    long: "The third part of a storage code. A bay with several levels is several bins.",
    example: "02",
    path: "/stock/locations",
  },
  {
    id: "level",
    group: "where",
    title: "Level",
    short: "The shelf height, with level 1 at the floor.",
    long: "Level 1 is left off the code, so A-01-02 is the floor shelf and A-01-02-2 is the one above it. Level 1 usually makes the best pick face; upper levels hold bulk.",
    example: "2",
    path: "/map",
  },
  {
    id: "bin",
    group: "where",
    title: "Bin",
    short: "The scannable spot stock sits in: a bay at one level, or a dock, bench, or outbound bay. Its code is its barcode.",
    long: "Rackline calls bins locations. Each has a type (receiving, storage, production, shipping) and can carry a slot role: a pick face pickers take from, or a bulk bay that refills it.",
    example: "A-01-02-2",
    term: "pick-face",
    path: "/stock/locations",
  },
  {
    id: "sku",
    group: "what",
    title: "SKU",
    short: "One thing you stock, make, or ship: raw, WIP, finished, or packaging.",
    long: "A SKU can track lots, serials, expiry dates, or catch-weight. It never holds a qty on its own.",
    example: "LED-BULB",
    term: "sku",
    path: "/stock/items",
  },
  {
    id: "on-hand",
    group: "what",
    title: "On hand",
    short: "Pieces of one SKU in one bin. Qty always lives on that pair, never on the SKU alone.",
    long: "It is the sum of the ledger, not a number typed on the item. Available to promise takes off holds and qty reserved for orders being picked.",
    example: "A-01-02 · LED-BULB × 40",
    term: "on-hand",
    path: "/stock",
  },
  {
    id: "overlay",
    group: "what",
    title: "Overlays",
    short: "Lots, serials, expiry dates, catch-weight, holds, and reservations sit on top of on hand.",
    long: "They never change the piece count. A hold locks stock in place; a reservation sets it aside for one order when its pick starts.",
    example: "LOT-2026-A · on hold",
    term: "hold",
    path: "/stock/items",
  },
  {
    id: "document",
    group: "how",
    title: "Document",
    short: "Paperwork with lines: a receipt, purchase order, order, putaway, work order, kit, or count.",
    long: "Each has a prefix (RCP-, PO-, ORD-, XFR-, WO-, KIT-) and tracks done against expected. Partial posts are fine; posting more than is left is refused.",
    example: "ORD-1042",
    term: "receipt",
    path: "/outbound/orders",
  },
  {
    id: "movement",
    group: "how",
    title: "Movement",
    short: "One posted line: qty leaves a bin, lands in a bin, or both. The ledger is the append-only list of them.",
    long: "Receive, move, pick, ship, build, adjust. On hand is recomputed from this list, so nothing is ever edited in place.",
    example: "pick · A-01-02 · LED-BULB × 4",
    term: "ledger",
    path: "/stock/ledger",
  },
  {
    id: "job",
    group: "how",
    title: "Floor job",
    short: "Open documents become ranked jobs on the floor. Next job offers the best one; a scan or post claims it.",
    long: "Unassigned work stays open to anyone. A second person on a claimed job is turned away until it is done or released.",
    example: "Pick ORD-1042 · 3 lines",
    term: "job",
    path: "/floor",
  },
];

const LEVEL_BY_ID = new Map(HIERARCHY_LEVELS.map((level) => [level.id, level]));

export function hierarchyLevel(id: HierarchyLevelId): HierarchyLevel {
  return LEVEL_BY_ID.get(id)!;
}

export function hierarchyLevelsIn(group: HierarchyGroupId): HierarchyLevel[] {
  return HIERARCHY_LEVELS.filter((level) => level.group === group);
}

/** Routes only an owner can open (they redirect operators home). */
const OWNER_ONLY_PREFIXES = ["/setup", "/live", "/labor", "/floor/adjust"];

function isOwnerOnlyPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? path;
  return OWNER_ONLY_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

/** The level's page if this person can open it: owner-only pages drop for operators, packed-away pages drop in Garage Mode. */
export function hierarchyPathFor(level: HierarchyLevel, viewer: { role: string; garage: boolean }): string | null {
  const path = level.path;
  if (!path) return null;
  if (viewer.role !== "owner" && isOwnerOnlyPath(path)) return null;
  if (viewer.garage && !garageAllowsPath(path)) return null;
  return path;
}

/* ------------------------------------------------------------------ bin codes */

export type BinAddress = { aisle: string; rack: string; bay: string; level: number };

export type BinCodePart = {
  id: "aisle" | "rack" | "bay" | "level";
  label: string;
  value: string;
  /** Level 1 is not written in the code; the part is still real. */
  implied: boolean;
};

const BIN_CODE = /^([A-Z]{1,3})-([A-Z0-9]{1,4})-([A-Z0-9]{1,4})(?:-(\d{1,2}))?$/;

/**
 * Read a storage code: "A-01-02-2" is aisle A, rack 01, bay 02, level 2; "A-01-02" is the same bay
 * at level 1. Dock, bench, and outbound codes ("DOCK", "SHIP-2") have no aisle and read as null.
 */
export function parseBinCode(code: string): BinAddress | null {
  const match = BIN_CODE.exec(code.trim().toUpperCase());
  if (!match) return null;
  const [, aisle, rack, bay, level] = match;
  const levelNumber = level ? Number.parseInt(level, 10) : 1;
  if (!Number.isInteger(levelNumber) || levelNumber < 1) return null;
  return { aisle: normalizeAisle(aisle!), rack: normalizeRack(rack!), bay: padBay(bay!), level: levelNumber };
}

/** The code split into labelled parts for a diagram, level included even when the code leaves it off. */
export function binCodeParts(address: BinAddress): BinCodePart[] {
  return [
    { id: "aisle", label: "Aisle", value: address.aisle, implied: false },
    { id: "rack", label: "Rack", value: address.rack, implied: false },
    { id: "bay", label: "Bay", value: address.bay, implied: false },
    { id: "level", label: "Level", value: String(address.level), implied: address.level === 1 },
  ];
}

/** "Aisle A / rack 01 / bay 02 / level 2" (level 1 is left off, like the code). */
export function formatBinAddress(address: BinAddress): string {
  return addressLabel(address) ?? "";
}

/* ------------------------------------------------------------------ the tree */

/** What the tree needs from a location, whether it exists yet or is only planned. */
export type HierarchyLocation = {
  id?: string;
  code: string;
  name?: string;
  type: string;
  area?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number | null;
  slotRole?: string | null;
  units?: number;
};

export type HierarchyNodeKind = "warehouse" | "area" | "rack" | "bay" | "bin";

export type HierarchyNode = {
  kind: HierarchyNodeKind;
  key: string;
  label: string;
  /** Monospace code: the bin's own code, or "A-01" for a rack. */
  code?: string;
  /** A short note: the area kind, or a bin's slot role. */
  note?: string;
  /** Bins under this node (a bin counts itself). */
  count: number;
  children: HierarchyNode[];
};

/** Plain word for a bin type, as the tree and the wizard show it. */
export function binKindLabel(type: string): string {
  switch (type) {
    case "receiving":
      return "Dock";
    case "storage":
      return "Storage";
    case "production":
      return "Bench";
    case "shipping":
      return "Outbound";
    default:
      return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Bin";
  }
}

export function slotRoleLabel(slotRole: string | null | undefined): string | null {
  if (slotRole === "pick") return "Pick face";
  if (slotRole === "bulk") return "Bulk";
  return null;
}

const TYPE_ORDER: Record<string, number> = { receiving: 0, storage: 1, production: 2, shipping: 3 };

function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isRackBin(location: HierarchyLocation): boolean {
  return location.type === "storage" && !!location.aisle && !!location.rack;
}

function binNode(location: HierarchyLocation): HierarchyNode {
  const role = slotRoleLabel(location.slotRole);
  const kind = location.type === "storage" ? null : binKindLabel(location.type);
  const level = location.level ?? 1;
  return {
    kind: "bin",
    key: `bin:${location.id ?? location.code}`,
    label: isRackBin(location) ? `Level ${level}` : (location.name ?? location.code),
    code: location.code,
    note: [kind, role].filter(Boolean).join(" · ") || undefined,
    count: 1,
    children: [],
  };
}

/**
 * Warehouse → areas → (racks → bays →) bins. Docks, benches, and outbound bays sit straight under
 * their area; storage bays hold one bin per level. Areas come in floor order: dock, aisles, bench,
 * outbound. Works the same for planned bins (no ids) as for real ones.
 */
export function buildHierarchyTree(warehouseName: string, locations: HierarchyLocation[]): HierarchyNode {
  const areas = new Map<string, { type: string; label: string; rows: HierarchyLocation[] }>();
  for (const location of locations) {
    const label = location.area?.trim() || areaForType(location.type, location.aisle);
    const key = `${location.type}:${label}`;
    const area = areas.get(key) ?? { type: location.type, label, rows: [] };
    area.rows.push(location);
    areas.set(key, area);
  }

  const areaNodes = [...areas.values()]
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || compareCodes(a.label, b.label))
    .map((area): HierarchyNode => {
      const rackRows = area.rows.filter(isRackBin);
      const loose = area.rows.filter((row) => !isRackBin(row));

      const racks = new Map<string, HierarchyLocation[]>();
      for (const row of rackRows) {
        const key = `${normalizeAisle(row.aisle!)}-${normalizeRack(row.rack!)}`;
        racks.set(key, [...(racks.get(key) ?? []), row]);
      }
      const rackNodes = [...racks.entries()]
        .sort(([a], [b]) => compareCodes(a, b))
        .map(([rackCode, rows]): HierarchyNode => {
          const bays = new Map<string, HierarchyLocation[]>();
          for (const row of rows) {
            const bay = padBay(row.bay ?? "01");
            bays.set(bay, [...(bays.get(bay) ?? []), row]);
          }
          const bayNodes = [...bays.entries()]
            .sort(([a], [b]) => compareCodes(a, b))
            .map(([bay, bins]): HierarchyNode => {
              const children = bins.slice().sort((a, b) => (a.level ?? 1) - (b.level ?? 1)).map(binNode);
              return {
                kind: "bay",
                key: `bay:${rackCode}-${bay}`,
                label: `Bay ${bay}`,
                code: `${rackCode}-${bay}`,
                count: children.length,
                children,
              };
            });
          return {
            kind: "rack",
            key: `rack:${rackCode}`,
            label: `Rack ${rackCode.split("-")[1]}`,
            code: rackCode,
            count: bayNodes.reduce((sum, node) => sum + node.count, 0),
            children: bayNodes,
          };
        });

      const looseNodes = loose.slice().sort((a, b) => compareCodes(a.code, b.code)).map(binNode);
      const children = [...rackNodes, ...looseNodes];
      return {
        kind: "area",
        key: `area:${area.type}:${area.label}`,
        label: area.label,
        note: binKindLabel(area.type),
        count: children.reduce((sum, node) => sum + node.count, 0),
        children,
      };
    });

  return {
    kind: "warehouse",
    key: "warehouse",
    label: warehouseName,
    count: areaNodes.reduce((sum, node) => sum + node.count, 0),
    children: areaNodes,
  };
}

export type HierarchySummary = {
  bins: number;
  areas: number;
  racks: number;
  bays: number;
  pickFaces: number;
  bulk: number;
  docks: number;
  benches: number;
  outbound: number;
};

/** Counts for a headline: "1 dock · 2 racks · 24 bins (8 pick faces)". */
export function summarizeHierarchy(locations: HierarchyLocation[]): HierarchySummary {
  const racks = new Set<string>();
  const bays = new Set<string>();
  const areas = new Set<string>();
  const summary: HierarchySummary = {
    bins: locations.length,
    areas: 0,
    racks: 0,
    bays: 0,
    pickFaces: 0,
    bulk: 0,
    docks: 0,
    benches: 0,
    outbound: 0,
  };
  for (const location of locations) {
    areas.add(`${location.type}:${location.area?.trim() || areaForType(location.type, location.aisle)}`);
    if (isRackBin(location)) {
      const rack = `${normalizeAisle(location.aisle!)}-${normalizeRack(location.rack!)}`;
      racks.add(rack);
      bays.add(`${rack}-${padBay(location.bay ?? "01")}`);
    }
    if (location.slotRole === "pick") summary.pickFaces += 1;
    if (location.slotRole === "bulk") summary.bulk += 1;
    if (location.type === "receiving") summary.docks += 1;
    if (location.type === "production") summary.benches += 1;
    if (location.type === "shipping") summary.outbound += 1;
  }
  summary.areas = areas.size;
  summary.racks = racks.size;
  summary.bays = bays.size;
  return summary;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One line for the summary, empty when there is nothing. */
export function describeHierarchy(summary: HierarchySummary): string {
  const parts: string[] = [];
  if (summary.docks) parts.push(plural(summary.docks, "dock", "docks"));
  if (summary.racks) {
    const storage = summary.bins - summary.docks - summary.benches - summary.outbound;
    const roles: string[] = [];
    if (summary.pickFaces) roles.push(plural(summary.pickFaces, "pick face", "pick faces"));
    if (summary.bulk) roles.push(plural(summary.bulk, "bulk bay", "bulk bays"));
    parts.push(
      `${plural(summary.racks, "rack", "racks")} with ${plural(storage, "bin", "bins")}${roles.length ? ` (${roles.join(", ")})` : ""}`,
    );
  }
  if (summary.benches) parts.push(plural(summary.benches, "bench", "benches"));
  if (summary.outbound) parts.push(plural(summary.outbound, "outbound bay", "outbound bays"));
  return parts.join(" · ");
}
