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
  /** SKU or item barcode scans made for this post, in any order. Serial and lot scans count as their SKU. */
  itemScans?: string[] | null;
};

export type ScanCheckLine = { lineId: string; qty: number; sku: string; barcode: string | null };

export type ScanVerb = "pick" | "pack";

export function requiresScan(policy: WorkflowPolicy, verb: ScanVerb): boolean {
  return verb === "pick" ? policy.scanVerifiedPick : policy.scanVerifiedPack;
}

/**
 * Verifies a floor post was scanned: the bay (for picks) and each posted line's SKU at least once.
 * Qty is keyed after the SKU scan, as on a directed-pick RF screen. Returns the first problem, or null.
 * Matching is case-insensitive on SKU or item barcode.
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
  const scanned = new Set((evidence?.itemScans ?? []).map((raw) => raw.trim().toUpperCase()).filter(Boolean));
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const keys = [line.sku, line.barcode ?? ""].map((key) => key.toUpperCase()).filter(Boolean);
    if (!keys.some((key) => scanned.has(key))) return `Scan ${line.sku} before posting`;
  }
  return null;
}

/** Throws the 409 the floor shows when a Manufacturer post is missing its scans. */
export function assertScanned(
  policy: WorkflowPolicy,
  verb: ScanVerb,
  lines: ScanCheckLine[],
  evidence: ScanEvidence | null | undefined,
  bay?: { code: string; barcode: string } | null,
): void {
  if (!requiresScan(policy, verb)) return;
  const problem = checkScanEvidence(lines, evidence, { bay: verb === "pick" ? bay : null });
  if (problem) throw new WorkflowPolicyError(`${problem}. Manufacturer mode ${verb}s by scan on the floor.`, "SCAN_REQUIRED");
}
