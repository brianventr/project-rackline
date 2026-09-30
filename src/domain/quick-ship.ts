import { suggestPickBay, type StockedBay } from "./partial-pick";
import { normalizeOrderStatus } from "./status";

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
  | { orderId: string; ok: true; number: string; trackingNumber: string | null }
  | { orderId: string; ok: false; number?: string; status: number; code?: string; error: string };

export function summarizeQuickShip(outcomes: QuickShipOutcome[]) {
  const shipped = outcomes.filter((row) => row.ok).length;
  return { shipped, failed: outcomes.length - shipped, total: outcomes.length };
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
