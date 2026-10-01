import { suggestPickBay, type StockedBay } from "./partial-pick";
import { normalizeOrderStatus } from "./status";
import { publicErrorText } from "../lib/db-errors";

export type QuickShipLine = {
  id: string;
  itemId: string;
  sku: string;
  qty: number;
  qtyPicked: number;
  qtyPacked: number;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type QuickShipOrder = {
  status: string;
  packageCount: number;
  lines: QuickShipLine[];
};

export type QuickShipPick = {
  locationId: string;
  locationCode: string;
  lines: { lineId: string; qty: number }[];
};

export type QuickShipRefusal = {
  ok: false;
  code: "NOT_SHIPPABLE" | "NEED_CARTON_FLOW" | "NEED_SCAN" | "INSUFFICIENT_ATP";
  error: string;
  sku?: string;
};

export type QuickShipPlan = {
  ok: true;
  picks: QuickShipPick[];
  /** True when every unit is already picked; only pack and ship remain. */
  pickDone: boolean;
  packNeeded: boolean;
};

const QUICK_STATUSES = new Set(["open", "picking", "picked", "packing", "packed"]);

export function canQuickShip(status: string): boolean {
  return QUICK_STATUSES.has(normalizeOrderStatus(status));
}

/**
 * Lots (first-expiring first) and serials (first in) are allocated by the ledger when a pick names none.
 * Catch-weight SKUs still need someone to weigh them.
 */
export function needsScanAtPick(line: Pick<QuickShipLine, "catchWeight">) {
  return Boolean(line.catchWeight);
}

export function planQuickShip(order: QuickShipOrder, baysByItem: Map<string, StockedBay[]>): QuickShipPlan | QuickShipRefusal {
  if (!canQuickShip(order.status)) {
    return { ok: false, code: "NOT_SHIPPABLE", error: `A ${normalizeOrderStatus(order.status)} order cannot be shipped` };
  }
  if (order.packageCount > 0) {
    return {
      ok: false,
      code: "NEED_CARTON_FLOW",
      error: "This order is packed in boxes. Open it to label and ship each box.",
    };
  }
  const toPick = order.lines
    .map((line) => ({ line, remaining: line.qty - line.qtyPicked }))
    .filter((row) => row.remaining > 0);
  const scan = toPick.find((row) => needsScanAtPick(row.line));
  if (scan) {
    return {
      ok: false,
      code: "NEED_SCAN",
      sku: scan.line.sku,
      error: `${scan.line.sku} is sold by weight. Weigh it on the floor pick, then ship here.`,
    };
  }

  const working = new Map<string, StockedBay[]>();
  for (const [itemId, bays] of baysByItem) working.set(itemId, bays.map((bay) => ({ ...bay })));
  const byLocation = new Map<string, QuickShipPick>();

  for (const { line, remaining } of toPick) {
    const bays = working.get(line.itemId) ?? [];
    let left = remaining;
    while (left > 0) {
      const bay = suggestPickBay(bays, left);
      if (!bay) {
        const available = remaining - left;
        return {
          ok: false,
          code: "INSUFFICIENT_ATP",
          sku: line.sku,
          error: `Only ${available} of ${remaining} ${line.sku} free to ship`,
        };
      }
      const take = Math.min(bay.qty, left);
      bay.qty -= take;
      left -= take;
      const pick = byLocation.get(bay.locationId) ?? { locationId: bay.locationId, locationCode: bay.locationCode, lines: [] };
      const existing = pick.lines.find((row) => row.lineId === line.id);
      if (existing) existing.qty += take;
      else pick.lines.push({ lineId: line.id, qty: take });
      byLocation.set(bay.locationId, pick);
    }
  }

  const picks = [...byLocation.values()];
  const packNeeded = order.lines.some((line) => line.qty - line.qtyPacked > 0);
  return { ok: true, picks, pickDone: picks.length === 0, packNeeded };
}

export type QuickShipOutcome =
  | {
      orderId: string;
      ok: true;
      number: string;
      trackingNumber: string | null;
      /** The channel has no live connection, so the owner marks the order shipped there. */
      manualPostBack?: boolean;
    }
  | { orderId: string; ok: false; number?: string; status: number; code?: string; error: string };

export function summarizeQuickShip(outcomes: QuickShipOutcome[]) {
  const shipped = outcomes.filter((row) => row.ok).length;
  return { shipped, failed: outcomes.length - shipped, total: outcomes.length };
}

export type QuickShipStepId = "pick" | "pack" | "label" | "ship";

export type QuickShipFailure = { status: number; error: string; code?: string };

/**
 * The label checks that need no carrier call, run before any stock moves so the usual
 * mistakes (no API key, an address the carrier cannot read) never cost a pick and unpick.
 */
export function quickShipLabelBlocker(input: {
  purchaseError?: string | null;
  live: boolean;
  hasApiKey: boolean;
  shipFrom?: object | { error: string } | null;
  shipTo?: object | { error: string } | null;
}): QuickShipFailure | null {
  if (input.purchaseError) return { status: 400, error: input.purchaseError };
  if (!input.live) return null;
  if (!input.hasApiKey) return { status: 400, error: "Live postage needs an API key" };
  for (const address of [input.shipFrom, input.shipTo]) {
    if (address && "error" in address) return { status: 409, error: String(address.error), code: "LIVE_ADDRESS" };
  }
  return null;
}

export type QuickShipStep = { id: QuickShipStepId; run: () => Promise<QuickShipFailure | null> };

export type QuickShipUndone =
  | { shipped: true }
  | { shipped: false; voidedLabel: boolean; voidError?: string | null; restoreError?: string | null };

export type QuickShipRun = { ok: true } | { ok: false; step: QuickShipStepId; failure: QuickShipFailure };

const STEP_ORDER: QuickShipStepId[] = ["pick", "pack", "label", "ship"];

/**
 * Runs the steps in pick, pack, label, ship order whatever order they arrive in, so postage is only
 * bought once the stock is picked and packed. The first failure (or throw) stops the run and calls
 * `undo` once to put the order back; the failure message says what the undo did.
 */
export async function runQuickShip(steps: QuickShipStep[], undo: () => Promise<QuickShipUndone>): Promise<QuickShipRun> {
  const ordered = [...steps].sort((a, b) => STEP_ORDER.indexOf(a.id) - STEP_ORDER.indexOf(b.id));
  for (const step of ordered) {
    let failure: QuickShipFailure | null;
    try {
      failure = await step.run();
    } catch (err) {
      failure = { status: 500, error: publicErrorText(err, `The ${step.id} step failed`) };
    }
    if (!failure) continue;
    let undone: QuickShipUndone;
    try {
      undone = await undo();
    } catch (err) {
      undone = { shipped: false, voidedLabel: false, restoreError: publicErrorText(err, "Undo failed") };
    }
    if (undone.shipped) return { ok: true };
    return { ok: false, step: step.id, failure: { ...failure, error: `${asSentence(failure.error)} ${quickShipUndoNote(undone)}` } };
  }
  return { ok: true };
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]["')]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function quickShipUndoNote(undone: Extract<QuickShipUndone, { shipped: false }>): string {
  const notes: string[] = [];
  if (undone.voidError) notes.push(`The label could not be voided (${undone.voidError}), so void it on the order.`);
  else notes.push(undone.voidedLabel ? "The label was voided." : "No label was bought.");
  if (undone.restoreError) {
    notes.push(`Pick and pack could not be undone (${undone.restoreError}), so unpick the order before shipping again.`);
  } else {
    notes.push("The order is back where it started.");
  }
  return notes.join(" ");
}

/** The order columns buying a label writes. */
export type QuickShipLabelFields = {
  labelStatus: string;
  trackingNumber: string | null;
  trackingCompany: string | null;
  trackingUrl: string | null;
  carrierService: string | null;
  carrierConnectionId: string | null;
  carrierShipmentId: string | null;
  carrierLabelId: string | null;
  postageCents: number | null;
  trackerStatus: string | null;
  trackerUpdatedAt: number | null;
  packageWeightOz: number | null;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
};

/** What an order looked like before quick-ship touched it. */
export type QuickShipSnapshot = {
  startedAt: number;
  status: string;
  pickedAt: number | null;
  packedAt: number | null;
  pickLocationId: string | null;
  hadLabel: boolean;
  /** Written back once a label this run bought is voided, so its service and parcel don't stick to the order. */
  label: QuickShipLabelFields;
  lines: { id: string; qtyPicked: number; qtyPacked: number }[];
  /** Open reservations with their qty. */
  allocations: { id: string; qty: number }[];
};

export type QuickShipCurrent = {
  status: string;
  labelStatus: string | null;
  trackingNumber: string | null;
  lines: { id: string; qtyPicked: number; qtyPacked: number }[];
  allocations: { id: string; qty: number }[];
};

export type QuickShipRestore = {
  /** The ship went through despite the error, so nothing is undone. */
  shipped: boolean;
  /** A label this run bought is still on the order. */
  voidLabel: boolean;
  /** Units this run picked, to go back to their bays. */
  unpick: { lineId: string; qty: number }[];
  /** Line counts to write back. Never raises a count someone else lowered meanwhile. */
  lines: { lineId: string; qtyPicked: number; qtyPacked: number }[];
  /** Reservations this run created. */
  releaseAllocationIds: string[];
  /** Reservations this run consumed, reset to their earlier qty. */
  resetAllocations: { id: string; qty: number }[];
  restoreOrder: boolean;
};

/** Diffs the order now against its snapshot to decide what undoing quick-ship takes. */
export function planQuickShipRestore(snapshot: QuickShipSnapshot, current: QuickShipCurrent): QuickShipRestore {
  if (normalizeOrderStatus(current.status) === "shipped") {
    return { shipped: true, voidLabel: false, unpick: [], lines: [], releaseAllocationIds: [], resetAllocations: [], restoreOrder: false };
  }
  const before = new Map(snapshot.lines.map((line) => [line.id, line]));
  const unpick: QuickShipRestore["unpick"] = [];
  const lines: QuickShipRestore["lines"] = [];
  for (const line of current.lines) {
    const prior = before.get(line.id);
    if (!prior) continue;
    const back = Math.max(0, line.qtyPicked - prior.qtyPicked);
    const qtyPicked = line.qtyPicked - back;
    const qtyPacked = Math.min(line.qtyPacked, prior.qtyPacked, qtyPicked);
    if (back > 0) unpick.push({ lineId: line.id, qty: back });
    if (qtyPicked !== line.qtyPicked || qtyPacked !== line.qtyPacked) lines.push({ lineId: line.id, qtyPicked, qtyPacked });
  }
  const kept = new Set(snapshot.allocations.map((row) => row.id));
  const openQty = new Map(current.allocations.map((row) => [row.id, row.qty]));
  return {
    shipped: false,
    voidLabel: !snapshot.hadLabel && current.labelStatus === "purchased" && Boolean(current.trackingNumber),
    unpick,
    lines,
    releaseAllocationIds: current.allocations.filter((row) => !kept.has(row.id)).map((row) => row.id),
    resetAllocations: snapshot.allocations.filter((row) => openQty.get(row.id) !== row.qty),
    restoreOrder: current.status !== snapshot.status || lines.length > 0,
  };
}

/** Stock this order already reserved is still free for this order to ship. */
export function withOwnReservations(
  baysByItem: Map<string, StockedBay[]>,
  reservations: { itemId: string; locationId: string; locationCode: string; qty: number }[],
): Map<string, StockedBay[]> {
  const out = new Map<string, StockedBay[]>();
  for (const [itemId, bays] of baysByItem) out.set(itemId, bays.map((bay) => ({ ...bay })));
  for (const row of reservations) {
    const bays = out.get(row.itemId) ?? [];
    const bay = bays.find((entry) => entry.locationId === row.locationId);
    if (bay) bay.qty += row.qty;
    else bays.push({ locationId: row.locationId, locationCode: row.locationCode, locationName: row.locationCode, barcode: "", qty: row.qty });
    out.set(row.itemId, bays);
  }
  return out;
}

export type ShipSetupStep = { id: "store" | "carrier" | "ship-from" | "box"; label: string; done: boolean; to: string };

export function shipSetupSteps(input: {
  storeConnected: boolean;
  carrierConnected: boolean;
  hasShipFrom: boolean;
  hasBox: boolean;
}): ShipSetupStep[] {
  return [
    { id: "store", label: "Connect a store", done: input.storeConnected, to: "/setup/integrations" },
    { id: "carrier", label: "Connect a carrier", done: input.carrierConnected, to: "/setup/carriers" },
    { id: "ship-from", label: "Set your ship-from address", done: input.hasShipFrom, to: "/setup/warehouse" },
    { id: "box", label: "Add your usual box", done: input.hasBox, to: "/ship?setup=box" },
  ];
}
