import { isGarageMode } from "./operating-mode";

/**
 * How the building moves an order out. Garage is pick-and-ship from one screen, like a shipping app.
 * Manufacturer is the directed warehouse flow: waves, scan-verified pick, a pack station, then ship.
 */
export type WorkflowPolicy = {
  mode: "garage" | "warehouse";
  /** One call picks from suggested bays, packs, buys the label, and ships. */
  quickShip: boolean;
  /** Floor pick must scan the bay and every unit's SKU before posting. */
  scanVerifiedPick: boolean;
  /** Pack must scan each unit at the pack station before the order is packed. */
  scanVerifiedPack: boolean;
  /** Office screens may post pick / pack for the operator without a floor scan. */
  officePickPack: boolean;
  /** Where an order's primary action goes. */
  shipFrom: "ship-queue" | "floor";
};

export const GARAGE_POLICY: WorkflowPolicy = {
  mode: "garage",
  quickShip: true,
  scanVerifiedPick: false,
  scanVerifiedPack: false,
  officePickPack: true,
  shipFrom: "ship-queue",
};

export const WAREHOUSE_POLICY: WorkflowPolicy = {
  mode: "warehouse",
  quickShip: false,
  scanVerifiedPick: true,
  scanVerifiedPack: true,
  officePickPack: false,
  shipFrom: "floor",
};

export function workflowPolicy(mode: string | null | undefined): WorkflowPolicy {
  return isGarageMode(mode) ? GARAGE_POLICY : WAREHOUSE_POLICY;
}

export class WorkflowPolicyError extends Error {
  constructor(
    message: string,
    public code: "WAREHOUSE_FLOW" | "SCAN_REQUIRED",
  ) {
    super(message);
    this.name = "WorkflowPolicyError";
  }
}

export function assertQuickShip(policy: WorkflowPolicy): void {
  if (!policy.quickShip) {
    throw new WorkflowPolicyError(
      "Manufacturer mode ships through the floor: pick, pack station, then ship. Switch to Garage Mode for one-click ship.",
      "WAREHOUSE_FLOW",
    );
  }
}

/** Scan evidence a floor post carries when the building requires scan-verified pick or pack. */
export type ScanEvidence = {
  /** Bay barcode or code the operator scanned. */
  locationScan?: string | null;
  /** One SKU barcode (or SKU) per unit scanned, in any order. */
  unitScans?: string[] | null;
};

export type ScanCheckLine = { lineId: string; qty: number; sku: string; barcode: string };

/**
 * Verifies the scans cover the posted qty. Returns the first problem as a message, or null when the scans cover it.
 * Matching is case-insensitive on SKU or barcode.
 */
export function checkScanEvidence(
  lines: ScanCheckLine[],
  evidence: ScanEvidence | null | undefined,
  options: { bay?: { code: string; barcode: string } | null } = {},
): string | null {
  if (options.bay) {
    const scanned = evidence?.locationScan?.trim().toUpperCase();
    if (!scanned) return `Scan bay ${options.bay.code} before posting`;
    if (scanned !== options.bay.code.toUpperCase() && scanned !== options.bay.barcode.toUpperCase()) {
      return `Scanned ${scanned}, but this pick is from ${options.bay.code}`;
    }
  }
  const counts = new Map<string, number>();
  for (const raw of evidence?.unitScans ?? []) {
    const key = raw.trim().toUpperCase();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const keys = [line.sku.toUpperCase(), line.barcode.toUpperCase()].filter(Boolean);
    let need = line.qty;
    for (const key of new Set(keys)) {
      const have = counts.get(key) ?? 0;
      const take = Math.min(have, need);
      counts.set(key, have - take);
      need -= take;
    }
    if (need > 0) return `Scan ${need} more ${line.sku}`;
  }
  return null;
}
