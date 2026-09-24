/**
 * Getting started: the checklist a new org (Garage Mode by default) works through,
 * derived entirely from data it already has, plus the sample catalog it can load to practice on.
 */

export type OnboardingStepId = "sku" | "bays" | "stock" | "shipped" | "shopify" | "carrier" | "teammate";

export type OnboardingStepMeta = {
  id: OnboardingStepId;
  title: string;
  body: string;
  cta: string;
  path: string;
  optional: boolean;
  ownerOnly: boolean;
};

export type OnboardingStepState = { id: OnboardingStepId; done: boolean; count: number };

/** In order: the four required steps take a new org from nothing to a shipped order, then the optional extras. */
export const ONBOARDING_STEPS: readonly OnboardingStepMeta[] = [
  {
    id: "sku",
    title: "Add your first SKU",
    body: "Name each thing you stock, build, or sell. Its SKU is what you scan.",
    cta: "Add a SKU",
    path: "/stock/items",
    optional: false,
    ownerOnly: false,
  },
  {
    id: "bays",
    title: "Set up your building",
    body: "Add a dock to receive on, the shelves or bays where stock lives, and a spot to ship from. The wizard walks you through it.",
    cta: "Set up",
    path: "/welcome",
    optional: false,
    ownerOnly: false,
  },
  {
    id: "stock",
    title: "Receive stock",
    body: "Log what arrived and the bay you put it in. On-hand counts start here.",
    cta: "Receive",
    path: "/inbound/receipts",
    optional: false,
    ownerOnly: false,
  },
  {
    id: "shipped",
    title: "Ship an order",
    body: "Create an order, then pick, pack, and ship it from the shelf.",
    cta: "New order",
    path: "/outbound/orders?new=1",
    optional: false,
    ownerOnly: false,
  },
  {
    id: "shopify",
    title: "Connect Shopify",
    body: "Pull store orders in and push stock levels back.",
    cta: "Connect",
    path: "/setup/shopify",
    optional: true,
    ownerOnly: true,
  },
  {
    id: "carrier",
    title: "Connect a carrier",
    body: "Buy real postage from UPS, FedEx, USPS, or DHL. Rackline Ground works until then.",
    cta: "Connect",
    path: "/setup/carriers",
    optional: true,
    ownerOnly: true,
  },
  {
    id: "teammate",
    title: "Invite a teammate",
    body: "Give someone on the floor their own sign-in and scanner.",
    cta: "Invite",
    path: "/setup/team",
    optional: true,
    ownerOnly: true,
  },
];

export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = ONBOARDING_STEPS.map((step) => step.id);

/** How many of a thing a step needs before it counts as done. A teammate means a second member. */
const THRESHOLD: Record<OnboardingStepId, number> = {
  sku: 1,
  bays: 1,
  stock: 1,
  shipped: 1,
  shopify: 1,
  carrier: 1,
  teammate: 2,
};

function cleanCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function onboardingStepMeta(id: OnboardingStepId): OnboardingStepMeta {
  return ONBOARDING_STEPS.find((step) => step.id === id)!;
}

/** Every step in checklist order with its done flag. Missing, negative, or non-numeric counts read as 0. */
export function evaluateOnboarding(counts: Record<OnboardingStepId, number>): OnboardingStepState[] {
  return ONBOARDING_STEPS.map((step) => {
    const count = cleanCount(counts[step.id]);
    return { id: step.id, done: count >= THRESHOLD[step.id], count };
  });
}

/**
 * Progress through the required steps. Optional steps (Shopify, a carrier, a teammate) get their own
 * check marks but never hold the checklist open, so `done`/`total` count required steps only and
 * `complete` is true once every required step is done. An empty list is not complete.
 */
export function onboardingProgress(steps: { done: boolean; optional?: boolean }[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.done).length;
  return { done, total: required.length, complete: required.length > 0 && done === required.length };
}

/** The step to nudge next: the first required step not done, else the first optional one not done or skipped. */
export function nextOnboardingStep(
  steps: { id: OnboardingStepId; done: boolean; optional?: boolean; skipped?: boolean }[],
): OnboardingStepId | null {
  const required = steps.find((step) => !step.optional && !step.done);
  if (required) return required.id;
  return steps.find((step) => step.optional && !step.done && !step.skipped)?.id ?? null;
}

/**
 * The "stock" signal: stock is on a shelf, or something was received for real (seeded demo receipts
 * do not count). Returns a count that is positive exactly when either is true.
 */
export function stockSignal(positiveBalanceRows: number, nonSeedReceives: number): number {
  const shelf = cleanCount(positiveBalanceRows);
  return shelf > 0 ? shelf : cleanCount(nonSeedReceives);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A short note for a done step, e.g. "4 SKUs" or "2 people". Null when there is nothing useful to say. */
export function onboardingCountLabel(id: OnboardingStepId, count: number): string | null {
  const n = cleanCount(count);
  switch (id) {
    case "sku":
      return n ? plural(n, "SKU", "SKUs") : null;
    case "bays":
      return n ? plural(n, "bay", "bays") : null;
    case "stock":
      // The count is either bays holding stock or, once it has all shipped, real receipts, so the
      // note has to be true for both.
      return n ? "Stock received" : null;
    case "shipped":
      return n ? `${plural(n, "order", "orders")} shipped` : null;
    case "shopify":
    case "carrier":
      return n ? "Connected" : null;
    case "teammate":
      return n >= 2 ? plural(n, "person", "people") : null;
  }
}

/* ------------------------------------------------------------------ sample catalog */

export const SAMPLE_SUFFIX = "(sample)";

export type SampleLocation = {
  key: string;
  code: string;
  name: string;
  type: "receiving" | "storage" | "shipping";
  slotRole: "pick" | "bulk" | "none";
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
};

export type SampleItem = {
  key: string;
  sku: string;
  name: string;
  type: "raw" | "finished";
  reorderPoint: number;
};

export type SampleBom = {
  parentKey: string;
  lines: { itemKey: string; qty: number }[];
  steps: { seq: number; title: string; body: string; componentKey: string | null }[];
};

export type SampleCatalog = { locations: SampleLocation[]; items: SampleItem[]; bom: SampleBom };

export function isSampleName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(SAMPLE_SUFFIX);
}

/**
 * A small, clearly labeled catalog to practice on: a receiving dock, three storage bays (one pick face,
 * one bulk bay, one spare), a shipping bay, three parts, and a candle built from them. No stock and no
 * orders: the checklist then walks the owner through receiving and shipping. Names end in "(sample)".
 */
export function buildSampleCatalog(): SampleCatalog {
  const bay = (key: string, code: string, name: string, bayNo: string, slotRole: SampleLocation["slotRole"]) => ({
    key,
    code,
    name: `${name} ${SAMPLE_SUFFIX}`,
    type: "storage" as const,
    slotRole,
    aisle: "A",
    rack: "01",
    bay: bayNo,
    level: 1,
  });
  return {
    locations: [
      {
        key: "dock",
        code: "DOCK",
        name: `Receiving dock ${SAMPLE_SUFFIX}`,
        type: "receiving",
        slotRole: "none",
        aisle: null,
        rack: null,
        bay: null,
        level: 1,
      },
      bay("pick", "A-01-01", "Pick face", "01", "pick"),
      bay("bulk", "A-01-02", "Bulk bay", "02", "bulk"),
      bay("spare", "A-01-03", "Spare bay", "03", "none"),
      {
        key: "ship",
        code: "SHIP",
        name: `Shipping bay ${SAMPLE_SUFFIX}`,
        type: "shipping",
        slotRole: "none",
        aisle: null,
        rack: null,
        bay: null,
        level: 1,
      },
    ],
    items: [
      { key: "candle", sku: "CANDLE", name: `Soy candle ${SAMPLE_SUFFIX}`, type: "finished", reorderPoint: 0 },
      { key: "jar", sku: "JAR", name: `Glass jar ${SAMPLE_SUFFIX}`, type: "raw", reorderPoint: 12 },
      { key: "wick", sku: "WICK", name: `Cotton wick ${SAMPLE_SUFFIX}`, type: "raw", reorderPoint: 24 },
      { key: "wax", sku: "WAX", name: `Soy wax pouch ${SAMPLE_SUFFIX}`, type: "raw", reorderPoint: 12 },
    ],
    bom: {
      parentKey: "candle",
      lines: [
        { itemKey: "jar", qty: 1 },
        { itemKey: "wick", qty: 1 },
        { itemKey: "wax", qty: 1 },
      ],
      steps: [
        { seq: 1, title: "Set the wick", body: "Stick one WICK to the center of the JAR base.", componentKey: "wick" },
        {
          seq: 2,
          title: "Pour the wax",
          body: "Melt one WAX pouch and pour it into the JAR up to the line.",
          componentKey: "wax",
        },
        {
          seq: 3,
          title: "Cure and label",
          body: "Let it set overnight, trim the wick, and scan the CANDLE label.",
          componentKey: "jar",
        },
      ],
    },
  };
}
