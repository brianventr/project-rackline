/**
 * "How Rackline works": the short tour a new person sees once, and can reopen from the palette,
 * the display menu, or the Getting started card. Owners get the office story (hierarchy, flow,
 * office and floor, modes); operators get the floor story (hierarchy, next job, scan, verbs).
 * Pure so the dialog only draws.
 */
import { homePath } from "./home-path";

export type TourAudience = "owner" | "operator";

export type TourStepId = "welcome" | "hierarchy" | "flow" | "workspaces" | "floor" | "modes" | "finish";

export type TourStep = {
  id: TourStepId;
  /** Small label over the title. */
  eyebrow: string;
  title: string;
  /** Plain paragraphs. The dialog adds the picture. */
  body: string[];
  /** Different words in Garage Mode, when the bench menu changes what to point at. */
  garageBody?: string[];
  audience: "all" | TourAudience;
};

/** Bump when the tour changes enough that people who saw it should see it again. */
export const TOUR_VERSION = 1;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    eyebrow: "Welcome",
    title: "Rackline keeps one ledger",
    body: [
      "Every piece of stock sits in a bin, and every change to it is a line on one append-only ledger. Receive, move, pick, ship, build, count, adjust: they all write there, so on hand is never a number someone typed.",
      "The office is where you plan and look. The floor is where you scan and do. Both read the same ledger, so what the floor posts is on the office screen a moment later.",
    ],
    audience: "all",
  },
  {
    id: "hierarchy",
    eyebrow: "The hierarchy",
    title: "Where, what, and how",
    body: [
      "Where stock sits runs from your organization down to a single bin: warehouse, area, then aisle, rack, bay, and level. A storage code spells that address, so A-01-02-2 is aisle A, rack 01, bay 02, second shelf up.",
      "What is there is a SKU in a bin. Qty lives on that pair, never on the SKU alone, and lots, serials, holds, and reservations sit on top of it. How it moves is a document, whose posted lines become ledger movements and floor jobs.",
    ],
    audience: "all",
  },
  {
    id: "flow",
    eyebrow: "The day",
    title: "Inbound, stock, make, outbound",
    body: [
      "Stock comes in on a receipt or a purchase order, lands on the dock, and is put away to a bay. From there it is counted, held, or replenished onto a pick face. Recipes turn parts into finished goods through work orders and kits. Orders are picked from bays, packed into cartons, and shipped with a label.",
      "Each document tracks done against expected, so a partial post is normal and posting more than is left is refused. Today lists what is open in each lane, and the floor ranks it into a next job.",
    ],
    garageBody: [
      "Buy parts on a purchase order, receive the box onto the dock, and put it on a shelf. Recipes turn those parts into finished goods through builds and kits. Orders are picked from the shelf, packed, and shipped with a label.",
      "Each document tracks done against expected, so a partial post is normal and posting more than is left is refused. Today lists what is open in each lane, and the floor ranks it into a next job.",
    ],
    audience: "owner",
  },
  {
    id: "workspaces",
    eyebrow: "Two screens",
    title: "Office and floor",
    body: [
      "The office is the sidebar: Today, Inbound, Stock, Make, Outbound, Analytics, and Settings. It is where documents are created, the map is drawn, and numbers are read.",
      "The floor is the handheld view at /floor: one verb per screen, big buttons, and a scan box that is always listening. A barcode gun, the camera, or typing all count as a scan. Search everything with ⌘K, or type a word with a question mark to look it up in the glossary.",
    ],
    audience: "owner",
  },
  {
    id: "floor",
    eyebrow: "Your screen",
    title: "The floor runs on scans",
    body: [
      "Next job is the top card: the best open piece of work for you, ranked from the ledger. Start it and the verb screen opens with the bay and the qty already filled in.",
      "Or pick a verb yourself. Receive, put away, pick, pack, ship, count, and the rest each have one screen. Scan a bay, a SKU, or a document number anywhere and Rackline works out what you meant. Your first scan or post claims the job so nobody doubles up.",
    ],
    audience: "operator",
  },
  {
    id: "modes",
    eyebrow: "Two sizes",
    title: "Garage Mode and Manufacturer",
    body: [
      "Garage Mode is the founder bench: buy parts, receive, build, pick, pack, ship, recipes, and runway, on a short menu. Manufacturer opens the rest of the floor: yard, ASNs, waves, replenishment, holds, counts, equipment, 3PL clients, EDI, and traffic.",
      "Both run on the same ledger and the same bins. Switching changes what shows, not what is stored, so start small and open the full warehouse when the floor needs it.",
    ],
    audience: "owner",
  },
  {
    id: "finish",
    eyebrow: "Next",
    title: "Start with the building",
    body: [
      "Name the building, add a dock, a rack of bays, and an outbound bay, and the map draws itself. Then add a SKU, receive some stock onto the dock, and ship an order. The Getting started card ticks each step off as the work lands.",
    ],
    garageBody: [
      "Name the bench, add a dock, a shelf of bays, and a place to ship from, and the map draws itself. Then add a SKU, receive some parts, and ship an order. The Getting started card ticks each step off as the work lands.",
    ],
    audience: "owner",
  },
  {
    id: "finish",
    eyebrow: "Next",
    title: "Start with a scan",
    body: [
      "Open the floor, look at Next job, and scan whatever is in front of you. Lookup shows what a bay holds or where a SKU is. Anything you post is on the office screens a moment later.",
    ],
    audience: "operator",
  },
];

export function tourAudience(role: string | null | undefined): TourAudience {
  return role === "owner" ? "owner" : "operator";
}

/** The steps this person sees, in order. */
export function tourStepsFor(viewer: { role: string | null | undefined }): TourStep[] {
  const audience = tourAudience(viewer.role);
  return TOUR_STEPS.filter((step) => step.audience === "all" || step.audience === audience);
}

/** The paragraphs for a step, in this shop's words. */
export function tourStepBody(step: TourStep, viewer: { garage: boolean }): string[] {
  return viewer.garage && step.garageBody ? step.garageBody : step.body;
}

/* ------------------------------------------------------------------ the day, as a picture */

export type FlowStageId = "inbound" | "stock" | "make" | "outbound";

export type FlowStop = {
  verb: string;
  /** Document prefix or object the verb works on. */
  doc?: string;
  note: string;
  /** Packed away in Garage Mode. */
  manufacturerOnly?: boolean;
};

export type FlowStage = {
  id: FlowStageId;
  title: string;
  garageTitle?: string;
  path: string;
  stops: FlowStop[];
};

export const FLOW_STAGES: readonly FlowStage[] = [
  {
    id: "inbound",
    title: "Inbound",
    garageTitle: "Parts",
    path: "/inbound/receipts",
    stops: [
      { verb: "Buy", doc: "PO-", note: "Draft a purchase order; sending it mints an expected ASN." },
      { verb: "Receive", doc: "RCP- · PO- · ASN-", note: "Post what arrived onto the dock. Partials are fine." },
      { verb: "Put away", doc: "XFR-", note: "Dock to a suggested bay: where the SKU already is, bulk first." },
    ],
  },
  {
    id: "stock",
    title: "Stock",
    garageTitle: "Shelf",
    path: "/stock",
    stops: [
      { verb: "Count", note: "Blind-count a bay; posting adjusts on hand to what you counted.", manufacturerOnly: true },
      { verb: "Hold", doc: "HLD-", note: "Lock a bay, a SKU in a bay, or a lot so picks skip it.", manufacturerOnly: true },
      { verb: "Replenish", doc: "RPL-", note: "Move bulk onto a pick face that fell below its min.", manufacturerOnly: true },
      { verb: "Adjust", note: "A signed change with a reason, for when the shelf and the ledger disagree." },
    ],
  },
  {
    id: "make",
    title: "Make",
    garageTitle: "Build",
    path: "/make/recipes",
    stops: [
      { verb: "Recipe", doc: "BOM", note: "What one finished unit consumes, plus numbered bench steps." },
      { verb: "Build", doc: "WO-", note: "A work order consumes parts from one bay and produces into another." },
      { verb: "Kit", doc: "KIT-", note: "The same explode in one step. A finished kit can be dekitted." },
    ],
  },
  {
    id: "outbound",
    title: "Outbound",
    garageTitle: "Ship",
    path: "/outbound/orders",
    stops: [
      { verb: "Order", doc: "ORD-", note: "Typed in, or landed from Shopify as a pick ticket." },
      { verb: "Pick", note: "Starting a pick reserves the qty. Pick from the suggested bay." },
      { verb: "Pack", doc: "BOX-n", note: "Packed units go into cartons with weight and size." },
      { verb: "Ship", note: "Buy a label, close the order, and Shopify hears back." },
    ],
  },
];

/** Stages with the stops this shop can see: Manufacturer-only verbs drop in Garage Mode. */
export function flowStagesFor(viewer: { garage: boolean }): FlowStage[] {
  return FLOW_STAGES.map((stage) => ({
    ...stage,
    title: viewer.garage && stage.garageTitle ? stage.garageTitle : stage.title,
    stops: stage.stops.filter((stop) => !viewer.garage || !stop.manufacturerOnly),
  }));
}

/* ------------------------------------------------------------------ seen, and when to open on its own */

/** Per person, per org, per browser; a new version starts fresh. */
export function tourSeenKey(orgId: string, userId: string): string {
  return `rackline.tour.seen:${orgId}:${userId}:v${TOUR_VERSION}`;
}

export type AutoOpenInput = {
  seen: boolean;
  role: string | null | undefined;
  pathname: string;
  /** Owners only: the Getting started read has landed. Operators pass null. */
  onboarding: { loaded: boolean; incomplete: boolean } | null;
};

/**
 * Open the tour by itself only on the person's home screen, only once per browser, and for owners
 * only while the shop is still being set up. An owner who has shipped orders and opens a new
 * browser is not sent back to square one; the tour stays a click away instead.
 */
export function shouldAutoOpenTour(input: AutoOpenInput): boolean {
  if (input.seen) return false;
  const bare = input.pathname.split(/[?#]/)[0] ?? input.pathname;
  const home = homePath(input.role ?? "operator");
  if (bare !== home && bare !== `${home}/`) return false;
  if (tourAudience(input.role) === "owner") {
    return !!input.onboarding && input.onboarding.loaded && input.onboarding.incomplete;
  }
  return true;
}

/** Index of a step id in this person's list, or 0 when it is not theirs. */
export function tourStepIndex(steps: readonly TourStep[], id: TourStepId | null | undefined): number {
  if (!id) return 0;
  const index = steps.findIndex((step) => step.id === id);
  return index < 0 ? 0 : index;
}
