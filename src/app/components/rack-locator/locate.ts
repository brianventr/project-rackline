import type { OrderAllocation, SuggestedLocation } from "../../api";
import {
  finalizeTargets,
  onHandTargets,
  pickTargets,
  receiveTargets,
  type RackTarget,
  type TargetDraft,
  type TargetItem,
  type TargetLocation,
  type TargetRole,
} from "@/domain/rack-targets";

export type LocateBay = { locationId: string | null | undefined; role: TargetRole; verb: string };

/** What a Today row needs to find its bays. `path` is the document read that carries the lines. */
export type Locate =
  /** Receipt, PO, or ASN: the dock it lands on and where directed putaway sends each SKU. */
  | { kind: "receive"; path: string; dockId: string | null }
  /** Order: the bays the remaining lines pick from. */
  | { kind: "pick"; path: string }
  /** Bays the document names outright. Items come from `items`, else from the lines at `path`. */
  | { kind: "bays"; bays: LocateBay[]; items?: TargetItem[]; path?: string }
  /** Every bay holding a SKU. */
  | { kind: "onHand"; itemId: string; sku: string };

type DetailLine = {
  id?: string;
  itemId: string;
  sku: string;
  qty?: number;
  qtyPicked?: number;
  remaining?: number;
  suggestedLocation?: SuggestedLocation | null;
  allocations?: OrderAllocation[];
};

export type LocateDetail = { lines?: DetailLine[] };

export type TargetPlanView = {
  targets: RackTarget[];
  unlocated: TargetItem[];
};

export function locateDetailPath(locate: Locate | null | undefined): string | null {
  if (!locate) return null;
  if (locate.kind === "receive" || locate.kind === "pick") return locate.path;
  if (locate.kind === "bays" && !locate.items) return locate.path ?? null;
  return null;
}

function openQty(line: DetailLine): number {
  return Math.max(0, line.remaining ?? line.qty ?? 0);
}

export function planTargets(
  locate: Locate,
  detail: LocateDetail | null | undefined,
  locations: TargetLocation[],
): TargetPlanView {
  const lines = detail?.lines ?? [];
  let drafts: TargetDraft[] = [];
  let unlocated: TargetItem[] = [];
  if (locate.kind === "receive") {
    const plan = receiveTargets({
      dockId: locate.dockId,
      lines: lines.map((line) => ({ itemId: line.itemId, sku: line.sku, qty: openQty(line) })),
      locations,
    });
    drafts = plan.targets;
    unlocated = plan.unlocated;
  } else if (locate.kind === "pick") {
    const plan = pickTargets(
      lines.map((line, index) => ({
        lineId: line.id ?? String(index),
        sku: line.sku,
        remaining: line.remaining ?? Math.max(0, (line.qty ?? 0) - (line.qtyPicked ?? 0)),
        suggestedLocation: line.suggestedLocation
          ? { locationId: line.suggestedLocation.locationId, locationCode: line.suggestedLocation.locationCode }
          : null,
        allocations: line.allocations,
      })),
      locations,
    );
    drafts = plan.targets;
    unlocated = plan.unlocated;
  } else if (locate.kind === "bays") {
    const items =
      locate.items ?? lines.map((line) => ({ sku: line.sku, qty: openQty(line) })).filter((item) => item.qty > 0);
    drafts = locate.bays
      .filter((bay): bay is LocateBay & { locationId: string } => Boolean(bay.locationId))
      .map((bay) => ({ locationId: bay.locationId, role: bay.role, verb: bay.verb, items }));
  } else {
    const plan = onHandTargets(locate.itemId, locate.sku, locations);
    drafts = plan.targets;
    unlocated = plan.unlocated;
  }
  return { targets: finalizeTargets(drafts, locations), unlocated };
}
