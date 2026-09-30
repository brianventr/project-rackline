import { isGarageMode } from "./operating-mode";

/**
 * How the building moves an order out. Garage is pick-and-ship from one screen, like a shipping app.
 * Manufacturer is the directed warehouse flow: waves, scan-verified pick, a pack station, then ship.
 */
export type WorkflowPolicy = {
  mode: "garage" | "warehouse";
  /** One call picks from suggested bays, packs, then buys the label and ships, undoing it all on failure. */
  quickShip: boolean;
  /** Floor pick must scan the bay and each SKU once before posting; the qty is typed after the SKU scan. */
  scanVerifiedPick: boolean;
  /** Pack must scan every unit at the pack station: one scan per unit posted. */
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
  /**
   * SKU or item barcode scans made for this post, one entry per scan, in any order. Serial and lot scans
   * count as their SKU. Pick needs each SKU once; pack needs one entry per unit.
   */
  itemScans?: string[] | null;
};

export type ScanCheckLine = { lineId: string; qty: number; sku: string; barcode: string | null };

export type ScanVerb = "pick" | "pack";

export function requiresScan(policy: WorkflowPolicy, verb: ScanVerb): boolean {
  return verb === "pick" ? policy.scanVerifiedPick : policy.scanVerifiedPack;
}

/**
 * Verifies a floor post was scanned. A pick needs the bay and one scan of each posted SKU; the qty is
 * typed after the SKU scan, as on a directed-pick RF screen. A pack (`perUnit`) needs one scan per unit
 * posted. Matching is case-insensitive on SKU or item barcode. Returns the first problem, or null.
 */
export function checkScanEvidence(
  lines: ScanCheckLine[],
  evidence: ScanEvidence | null | undefined,
  options: { bay?: { code: string; barcode: string } | null; perUnit?: boolean } = {},
): string | null {
  if (options.bay) {
    const scanned = evidence?.locationScan?.trim().toUpperCase();
    if (!scanned) return `Scan bay ${options.bay.code} before posting`;
    if (scanned !== options.bay.code.toUpperCase() && scanned !== options.bay.barcode.toUpperCase()) {
      return `Scanned ${scanned}, but this pick is from ${options.bay.code}`;
    }
  }
  for (const posted of postedBySku(lines)) {
    const scanned = countScans(evidence?.itemScans, posted);
    if (scanned === 0) return `Scan ${posted.sku} before posting`;
    if (options.perUnit && scanned < posted.qty) {
      return `Scan every unit of ${posted.sku}: ${scanned} of ${posted.qty} scanned`;
    }
  }
  return null;
}

/** How many scans name this SKU, by SKU or item barcode. */
export function countScans(
  itemScans: string[] | null | undefined,
  sku: { sku: string; barcode: string | null },
): number {
  const keys = new Set([sku.sku, sku.barcode ?? ""].map((key) => key.trim().toUpperCase()).filter(Boolean));
  return (itemScans ?? []).filter((raw) => keys.has(raw.trim().toUpperCase())).length;
}

/** Posted qty per SKU, since one order can carry a SKU on two lines. */
function postedBySku(lines: ScanCheckLine[]): { sku: string; barcode: string | null; qty: number }[] {
  const bySku = new Map<string, { sku: string; barcode: string | null; qty: number }>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const key = line.sku.trim().toUpperCase();
    const posted = bySku.get(key);
    if (posted) posted.qty += line.qty;
    else bySku.set(key, { sku: line.sku, barcode: line.barcode, qty: line.qty });
  }
  return [...bySku.values()];
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
  const problem = checkScanEvidence(lines, evidence, { bay: verb === "pick" ? bay : null, perUnit: verb === "pack" });
  if (problem) throw new WorkflowPolicyError(`${problem}. Manufacturer mode ${verb}s by scan on the floor.`, "SCAN_REQUIRED");
}
