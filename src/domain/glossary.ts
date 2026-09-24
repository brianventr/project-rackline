import { garageAllowsPath } from "./operating-mode";

/**
 * Plain-language definitions for the warehouse words Rackline uses on screen.
 * `short` is what a hover card or the command palette shows; `long` adds how this app
 * behaves. `path` is the page that best shows the idea, when there is one.
 */
export type GlossaryEntry = { id: string; term: string; aliases: string[]; short: string; long?: string; path?: string };

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: "atp",
    term: "ATP",
    aliases: ["available to promise", "available", "available qty"],
    short: "Available to promise: what is in a bay minus held stock and qty already reserved for orders being picked.",
    long: "Starting a pick reserves against ATP. A second order that would oversell is blocked (INSUFFICIENT_ATP). A Promise quote does not reserve anything.",
    path: "/stock",
  },
  {
    id: "on-hand",
    term: "On hand",
    aliases: ["onhand", "on hand qty", "balance", "stock on hand", "soh"],
    short: "Pieces physically in a bay, summed from the movement ledger. It still counts held and reserved stock.",
    path: "/stock",
  },
  {
    id: "allocation",
    term: "Allocation",
    aliases: ["reservation", "reserve", "reserved", "allocated"],
    short: "Qty set aside for one order at one bay. It is made when pick starts, not when the order is created.",
    long: "Pick, move, replenish, kit, work order, and RTV cannot take another order's reservation. Leftovers release on ship or cancel; unpick puts the reservation back.",
    path: "/outbound/orders",
  },
  {
    id: "sellable",
    term: "Sellable qty",
    aliases: ["sellable", "available to sell", "shopify qty", "shopify inventory"],
    short: "What Rackline pushes to Shopify: on hand minus held minus qty still to pick on open orders.",
    long: "It updates after stock posts, Shopify orders, holds, and cancels. SKUs without a Shopify inventory item are skipped.",
    path: "/setup/shopify",
  },
  {
    id: "sku",
    term: "SKU",
    aliases: ["stock keeping unit", "item", "product", "part"],
    short: "One thing you stock, make, or ship. Its barcode defaults to the SKU code.",
    long: "Each SKU is raw, WIP, packaging, or finished, and can track lots, serials, expiry, or catch-weight.",
    path: "/stock/items",
  },
  {
    id: "wip",
    term: "WIP",
    aliases: ["work in progress", "subassembly", "sub assembly"],
    short: "A part-built SKU with its own recipe that goes into another build.",
    path: "/make/recipes",
  },
  {
    id: "ledger",
    term: "Ledger",
    aliases: ["movement ledger", "movements", "stock history", "inventory ledger"],
    short: "The append-only list of every receive, move, pick, ship, build, and adjustment. On hand is the sum of it.",
    path: "/stock/ledger",
  },
  {
    id: "bin",
    term: "Bin",
    aliases: ["location", "bay", "slot", "storage location", "bin code", "location code"],
    short: "The scannable spot stock sits in: a bay at one level, or a dock, bench, or outbound bay. Its code is its barcode.",
    long: "Every bin has a type (receiving, storage, production, shipping) and a slot role (pick face or bulk). Qty always lives on a SKU in a bin, never on the SKU alone.",
    path: "/stock/locations",
  },
  {
    id: "bin-address",
    term: "Bin address",
    aliases: ["aisle", "rack", "level", "address", "aisle rack bay level", "bay code", "a-01-02"],
    short: "A storage code reads aisle, rack, bay, level: A-01-02-2 is aisle A, rack 01, bay 02, second shelf up. Level 1 is left off.",
    long: "Pick lists walk that order: aisle, then rack, then bay, then level. Build floor adds a whole rack of bays at once.",
    path: "/map",
  },
  {
    id: "dock",
    term: "Dock",
    aliases: ["receiving dock", "dock door", "receiving bay", "dock bay"],
    short: "A receiving bay where inbound stock lands before putaway. Today lists dock stock waiting to go to a bay.",
    long: "Trailers in the yard are assigned to a dock. Receipts, purchase orders, ASNs, and returns all receive onto one.",
    path: "/stock/locations",
  },
  {
    id: "receipt",
    term: "Receipt",
    aliases: ["rcp", "receiving", "receive"],
    short: "An inbound document (RCP-) listing what is coming in. Receive it on the dock, partials allowed.",
    long: "Each line tracks received against expected. Receiving more than is left is blocked (OVER_RECEIVE).",
    path: "/inbound/receipts",
  },
  {
    id: "purchase-order",
    term: "Purchase order",
    aliases: ["po", "purchase", "buy parts", "vendor order"],
    short: "What you ordered from a vendor (PO-). Send the draft to mint an expected ASN, then receive it on the dock.",
    long: "Draft PO on Today fills the gap up to each SKU's reorder point from the last vendor you bought it from.",
    path: "/inbound/purchases",
  },
  {
    id: "asn",
    term: "ASN",
    aliases: ["advance ship notice", "advance shipping notice", "vendor notice", "inbound notice"],
    short: "Advance ship notice: what a vendor says is on the truck. Receive it on the dock like a purchase order, partials allowed.",
    long: "Sending a PO mints an expected ASN for the remaining qty. Vendor boxes on an ASN are received one at a time.",
    path: "/inbound/asns",
  },
  {
    id: "sscc",
    term: "Vendor carton",
    aliases: ["sscc", "vendor box", "inbound carton", "asn carton", "serial shipping container code"],
    short: "A vendor box on an ASN, numbered BOX-n with an optional SSCC barcode. The dock receives and puts it away one box at a time.",
    long: "Once an ASN has boxes, loose receive is blocked (NEED_PACKAGE). A box still on the dock can be unreceived; one that was put away cannot.",
    path: "/inbound/asns",
  },
  {
    id: "edi",
    term: "EDI",
    aliases: ["electronic data interchange", "edi inbox", "supplier edi"],
    short: "A supplier posts its ASN to Rackline as JSON (no X12). Each one lands in the EDI inbox and creates an expected ASN.",
    path: "/setup/edi",
  },
  {
    id: "yard-visit",
    term: "Yard visit",
    aliases: ["yard", "trailer", "yrd", "gate check in", "trailer visit"],
    short: "A trailer's stay at your site (YRD-): expected, checked in at the gate, at a dock, then checked out.",
    long: "Assigning a dock ties a linked ASN to that dock so the floor receives it there.",
    path: "/inbound/yard",
  },
  {
    id: "putaway",
    term: "Putaway",
    aliases: ["put away", "transfer", "xfr", "bin to bin move"],
    short: "Moving stock off the dock onto a storage bay. Rackline suggests a bay: where the SKU already is, bulk first, near its pick face.",
    long: "Putaway tickets (XFR-) track moved against expected qty and stay in progress until every unit has left the from-bay.",
    path: "/inbound/putaway",
  },
  {
    id: "pick-face",
    term: "Pick face",
    aliases: ["pick bay", "forward pick", "pick slot", "pick location"],
    short: "The bay pickers take a SKU from. When it drops below the SKU's pick min, replenish tops it up from bulk.",
    path: "/stock/locations",
  },
  {
    id: "bulk-bay",
    term: "Bulk bay",
    aliases: ["bulk", "bulk storage", "reserve storage", "overstock"],
    short: "A storage bay that holds extra stock. Putaway prefers bulk; replenish moves it from bulk to the pick face.",
    path: "/stock/locations",
  },
  {
    id: "pick-min",
    term: "Pick min",
    aliases: ["pick minimum", "min qty"],
    short: "The fewest pieces a SKU's pick face should hold. When it drops below, a replenishment is due.",
    path: "/stock/replenish",
  },
  {
    id: "replenish",
    term: "Replenish",
    aliases: ["replenishment", "top up", "rpl"],
    short: "Move stock from a bulk bay onto a pick face that is below the SKU's pick min (RPL-). Partial moves are allowed.",
    long: "Different from dock putaway: replenish only feeds pick faces.",
    path: "/stock/replenish",
  },
  {
    id: "zone",
    term: "Zone",
    aliases: ["zones", "area", "pick zone"],
    short: "A named group of bays, like an aisle or area. A wave scoped to a zone prefers its bays for picks.",
    path: "/setup/zones",
  },
  {
    id: "lot",
    term: "Lot",
    aliases: ["lot code", "lot number", "batch number", "batch code"],
    short: "A vendor batch code on stock for lot-tracked SKUs. Receive needs one; pick and move take the oldest lot when none is scanned.",
    path: "/floor/lookup",
  },
  {
    id: "serial",
    term: "Serial",
    aliases: ["serial number", "serials", "serialized", "sn"],
    short: "A unique code on each unit of a serial-tracked SKU. Receive needs one serial per piece.",
    long: "Lookup shows what a serial was built from and what it went into.",
    path: "/floor/lookup",
  },
  {
    id: "expiry",
    term: "Expiry",
    aliases: ["expiration", "expiry date", "expires on", "best before", "use by", "expiring"],
    short: "A date on each lot of an expiry-tracked SKU. Expired lots are skipped on pick; Today lists lots expiring within 14 days.",
    path: "/stock/items",
  },
  {
    id: "fefo",
    term: "FEFO",
    aliases: ["first expired first out", "first expiry first out", "earliest expiry"],
    short: "First expired, first out: pick takes the lot with the earliest expiry date first and skips expired stock.",
    long: "Lots that expire before an order would ship do not count toward Promise or Runway cover.",
  },
  {
    id: "fifo",
    term: "FIFO",
    aliases: ["first in first out", "oldest lot"],
    short: "First in, first out: when no lot or serial is scanned, pick and move take the oldest one first.",
  },
  {
    id: "catch-weight",
    term: "Catch-weight",
    aliases: ["catch weight", "variable weight", "weight in grams", "weigh"],
    short: "A SKU counted in whole pieces whose weight varies. Enter grams on receive, pick, and count.",
    long: "The weight is copied onto ship and shown on the document and ledger. Qty stays in pieces.",
    path: "/stock/items",
  },
  {
    id: "alt-unit",
    term: "Alt unit",
    aliases: ["alt uom", "uom", "unit of measure", "case qty", "dual uom"],
    short: "An optional second unit on a SKU, like a case of 12. Receive and pick accept it and convert to stock pieces.",
    path: "/stock/items",
  },
  {
    id: "cycle-count",
    term: "Cycle count",
    aliases: ["count", "counts", "stock take", "stocktake"],
    short: "Count one bay without stopping work. Posting adjusts on hand to what was counted.",
    long: "A SKU that was not on the bay's snapshot can be scanned or added. Posting adjusts against current on hand, so moves during the count are not double-counted.",
    path: "/stock/counts",
  },
  {
    id: "blind-count",
    term: "Blind count",
    aliases: ["blind", "blind cycle count"],
    short: "A count where the counter sees SKUs but not system qty until it is posted. Typing 0 is a real empty count.",
    path: "/stock/counts",
  },
  {
    id: "variance",
    term: "Variance",
    aliases: ["count variance", "discrepancy", "shrink", "over short"],
    short: "Counted qty minus system qty on a posted count. Today lists counts where they differ.",
    path: "/stock/counts",
  },
  {
    id: "adjustment",
    term: "Adjustment",
    aliases: ["adjust", "write off"],
    short: "A signed qty change on a bay with a reason. It cannot take a bay below zero.",
    path: "/floor/adjust",
  },
  {
    id: "hold",
    term: "Hold",
    aliases: ["qc hold", "quarantine", "lock", "held", "held stock"],
    short: "A lock on a bay, one SKU in a bay, or one lot. Pick, move, replenish, kit, work order, and RTV cannot take it; qty stays on the ledger.",
    long: "Taking held stock is blocked (HELD_STOCK) until the hold is released. Receive, count, adjust, produce, ship, and scrap still post. FIFO passes over a held lot when other lots cover the qty.",
    path: "/stock/holds",
  },
  {
    id: "wave",
    term: "Wave",
    aliases: ["wave pick", "wav", "waves"],
    short: "A group of open orders released to the floor together (WAV-). The wave completes when every order on it is picked.",
    path: "/outbound/waves",
  },
  {
    id: "batch-pick",
    term: "Batch pick",
    aliases: ["batch", "batch mode", "consolidated pick"],
    short: "A wave in batch mode: each SKU's qty is added up across the orders, picked in one trip, then spread back over those orders.",
    path: "/outbound/waves",
  },
  {
    id: "pick-list",
    term: "Pick list",
    aliases: ["pick ticket", "picking list", "walk"],
    short: "The printed walk for an order or wave: bay, SKU, remaining qty, and FEFO lots, in aisle, rack, bay, level order.",
    path: "/outbound/orders",
  },
  {
    id: "unpick",
    term: "Unpick",
    aliases: ["put back", "return to bay"],
    short: "Put picked but unpacked qty back on a bay. The order's reservation comes back with it.",
    path: "/outbound/orders",
  },
  {
    id: "carton",
    term: "Carton",
    aliases: ["box", "box-n", "package", "parcel", "outbound carton"],
    short: "An outbound box on an order (BOX-1, BOX-2) with its own weight, size, label, and tracking.",
    long: "Cartons are optional until the first one exists. Then every packed unit must be in a labeled box before ship.",
    path: "/outbound/orders",
  },
  {
    id: "pack-slip",
    term: "Pack slip",
    aliases: ["packing slip", "packing list"],
    short: "The paper in the box: ordered, picked, and packed qty, plus each BOX-n barcode and tracking.",
    path: "/outbound/orders",
  },
  {
    id: "short-ship",
    term: "Short ship",
    aliases: ["ship short", "partial ship"],
    short: "Close a packing order once at least one carton has left. Unshipped units go back to the bay and the rest becomes a backorder.",
    path: "/outbound/orders",
  },
  {
    id: "backorder",
    term: "Backorder",
    aliases: ["back order", "bo"],
    short: "The follow-up order a short ship creates for what did not leave (ORD-…-BO). It reserves stock only when its pick starts.",
    path: "/outbound/orders",
  },
  {
    id: "rma",
    term: "RMA",
    aliases: ["return merchandise authorization", "customer return", "return"],
    short: "A customer return. Receive it back into a bay and choose restock, scrap, or hold for each line.",
    path: "/outbound/returns",
  },
  {
    id: "disposition",
    term: "Disposition",
    aliases: ["return disposition", "restock", "scrap"],
    short: "What happens to a returned unit on receive: restock it in the bay, scrap it (on hand unchanged), or hold it for QC.",
    path: "/outbound/returns",
  },
  {
    id: "rtv",
    term: "RTV",
    aliases: ["return to vendor", "vendor return", "vendor rtv"],
    short: "Return to vendor: stock leaves a bay and goes back to the supplier (RTV-). Partial qty is allowed; over-return is blocked.",
    path: "/inbound/vendor-returns",
  },
  {
    id: "recipe",
    term: "Recipe",
    aliases: ["bom", "bill of materials", "recipes", "kitting steps"],
    short: "What one unit of a finished or WIP SKU consumes, plus numbered steps for the bench. Kits and work orders build from it.",
    path: "/make/recipes",
  },
  {
    id: "work-order",
    term: "Work order",
    aliases: ["wo", "build", "builds", "assemble", "production order"],
    short: "A build of a finished SKU (WO-). Each complete takes recipe qty from the source bay and puts finished goods in the output bay.",
    long: "Partial completes are allowed; the work order stays in progress until the full qty is built.",
    path: "/make/work-orders",
  },
  {
    id: "kit",
    term: "Kit",
    aliases: ["kitting", "kit build", "kits"],
    short: "Assemble a finished SKU from its recipe (KIT-). Components leave one bay and finished kits land in another.",
    long: "Partial completes are allowed. Unlike a work order, a fully completed kit can be dekitted.",
    path: "/make/kits",
  },
  {
    id: "dekit",
    term: "Dekit",
    aliases: ["unkit", "break kit", "disassemble"],
    short: "Reverse a fully completed kit. Finished units leave the output bay and the same component lots and serials go back.",
    path: "/make/kits",
  },
  {
    id: "as-built",
    term: "As-built",
    aliases: ["as built", "genealogy", "traceability", "built from", "used in"],
    short: "The record of which component lots and serials went into each finished serial or lot. Scan either one in Lookup.",
    path: "/floor/lookup",
  },
  {
    id: "3pl-client",
    term: "3PL client",
    aliases: ["3pl", "client", "third party logistics", "client code"],
    short: "A brand you store and ship for. Its code tags orders, ASNs, and waves, and billing drafts one invoice per client.",
    long: "Stock stays on the same bays; outbound checks that the client has its own qty there (CLIENT_STOCK).",
    path: "/setup/clients",
  },
  {
    id: "job",
    term: "Floor job",
    aliases: ["job", "next job", "my jobs", "claim"],
    short: "One piece of floor work from an open document. Next job ranks them; your first scan or post claims it for you.",
    long: "A second person on a claimed job is blocked (JOB_CLAIMED). Unassigned work stays open to anyone.",
    path: "/floor",
  },
  {
    id: "cutoff",
    term: "Carrier cutoff",
    aliases: ["cutoff", "pickup", "carrier pickup", "last pickup"],
    short: "The daily carrier pickup, 3:00pm warehouse time. Promise quotes which pickup an order makes.",
    path: "/analytics/promise",
  },
  {
    id: "promise",
    term: "Promise",
    aliases: ["leave by", "ship date quote", "delivery promise"],
    short: "A leave-by quote for an open order or a new qty of a SKU, from the shelf, the pick queue, floor pace, and dated inbound.",
    long: "A promise does not reserve stock. Pick start still owns ATP.",
    path: "/analytics/promise",
  },
  {
    id: "runway",
    term: "Runway",
    aliases: ["days of cover", "stockout", "days until stockout", "cover"],
    short: "Days until a SKU runs out at its ship rate. Cover is sellable qty plus dated inbound, minus recipe burn and lots that expire first.",
    path: "/analytics/runway",
  },
  {
    id: "reorder-point",
    term: "Reorder point",
    aliases: ["rop", "reorder", "low stock", "reorder queue"],
    short: "When on hand falls to this qty, the SKU joins Today's reorder queue. Draft PO orders the gap back up to it.",
    path: "/stock/items",
  },
  {
    id: "garage-mode",
    term: "Garage Mode",
    aliases: ["garage", "bench", "founder bench", "full warehouse"],
    short: "The short setup new shops start in: receive, make, pick, pack, ship, recipes, and runway. Open the full warehouse in Settings.",
    long: "The full warehouse adds yard, waves, ASNs, equipment, replenish, holds, counts, 3PL clients, EDI, and traffic on the same ledger.",
    path: "/setup/warehouse",
  },
];

const BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));

/** Lowercase, drop apostrophes, and turn every other symbol into a single space. */
export function normalizeGlossaryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const LEADING_FILLER = new Set([
  "what",
  "whats",
  "who",
  "is",
  "are",
  "does",
  "do",
  "a",
  "an",
  "the",
  "define",
  "definition",
  "meaning",
  "of",
  "explain",
  "glossary",
  "term",
  "tell",
  "me",
  "about",
]);
const TRAILING_FILLER = new Set(["mean", "means", "meaning", "stand", "stands", "for"]);

/** "What is FEFO?" → "fefo". Falls back to the whole query when it is only filler words. */
export function glossaryQueryText(query: string): string {
  const words = normalizeGlossaryText(query).split(" ").filter(Boolean);
  let start = 0;
  let end = words.length;
  while (start < end && LEADING_FILLER.has(words[start]!)) start += 1;
  while (end > start && TRAILING_FILLER.has(words[end - 1]!)) end -= 1;
  const core = words.slice(start, end);
  return (core.length ? core : words).join(" ");
}

/** True when the palette query reads like a question about a word, not a record search. */
export function isGlossaryQuestion(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  return /^(what|whats|what's|define|definition|meaning|explain|glossary)\b/i.test(trimmed);
}

function compact(text: string): string {
  return text.replace(/ /g, "");
}

function nameScore(name: string, q: string, isTerm: boolean): number {
  const n = normalizeGlossaryText(name);
  if (!n) return 0;
  const bonus = isTerm ? 5 : 0;
  const nc = compact(n);
  const qc = compact(q);
  if (n === q || nc === qc) return 95 + bonus;
  if (n.startsWith(q) || nc.startsWith(qc)) return 75 + bonus;
  const words = n.split(" ");
  if (n.includes(` ${q}`)) return 60 + bonus;
  const tokens = q.split(" ");
  if (tokens.length > 1 && tokens.every((token) => words.some((word) => word.startsWith(token)))) return 45 + bonus;
  if (q.length >= 3 && n.includes(q)) return 35 + bonus;
  return 0;
}

/** 0 when the entry does not match. Higher is better; the term outranks an alias of the same strength. */
export function glossaryScore(entry: GlossaryEntry, query: string): number {
  const q = glossaryQueryText(query);
  if (!q) return 0;
  let best = nameScore(entry.term, q, true);
  for (const alias of entry.aliases) best = Math.max(best, nameScore(alias, q, false));
  return best;
}

/** Entries whose term or an alias matches, best first. Blank queries return nothing. */
export function searchGlossary(query: string): GlossaryEntry[] {
  if (!glossaryQueryText(query)) return [];
  return GLOSSARY.map((entry, index) => ({ entry, index, score: glossaryScore(entry, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.entry);
}

/** Where the command palette puts its Glossary group, or "hidden" while it must wait. */
export type GlossaryPaletteSlot = "first" | "last" | "hidden";

/**
 * Many page names are also glossary words (Waves, Ledger, Receive), so a plain query never lets the
 * Glossary take the first slot: it goes after Records, Actions, and Go to, and waits for the record
 * search so a matching SKU, bay, or order is still what Enter opens. Only a question ("what is fefo")
 * leads with the Glossary, and only when no page or action matches the text.
 */
export function glossaryPaletteSlot(
  query: string,
  palette: { pageOrActionMatches: number; searchingRecords: boolean },
): GlossaryPaletteSlot {
  if (isGlossaryQuestion(query)) return palette.pageOrActionMatches > 0 ? "last" : "first";
  return palette.searchingRecords ? "hidden" : "last";
}

/** Look up by id. Also accepts an exact term or alias ("BOM", "SSCC") so callers can pass the word they show. */
export function glossaryEntry(id: string): GlossaryEntry | undefined {
  const direct = BY_ID.get(id);
  if (direct) return direct;
  const wanted = normalizeGlossaryText(id);
  if (!wanted) return undefined;
  const byId = GLOSSARY.find((entry) => normalizeGlossaryText(entry.id) === wanted);
  if (byId) return byId;
  return GLOSSARY.find(
    (entry) =>
      normalizeGlossaryText(entry.term) === wanted || entry.aliases.some((alias) => normalizeGlossaryText(alias) === wanted),
  );
}

/** Routes only an owner can open (they redirect operators home). */
const OWNER_ONLY_PREFIXES = ["/setup", "/live", "/labor", "/floor/adjust"];

function isOwnerOnlyPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? path;
  return OWNER_ONLY_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

/** The entry's page if this person can open it: owners-only pages drop for operators, packed-away pages drop in Garage Mode. */
export function glossaryPathFor(entry: GlossaryEntry, viewer: { role: string; garage: boolean }): string | null {
  const path = entry.path;
  if (!path) return null;
  if (viewer.role !== "owner" && isOwnerOnlyPath(path)) return null;
  if (viewer.garage && !garageAllowsPath(path)) return null;
  return path;
}
