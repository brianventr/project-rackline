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

/** A pack barcode on the line's item: one scan of it counts `qty` units. */
export type ScanPack = { barcode: string | null; qty: number };

export type ScanCheckLine = { lineId: string; qty: number; sku: string; barcode: string | null; packs?: ScanPack[] };

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

/** Units scanned for this SKU: one per SKU or item barcode scan, a pack's qty per pack barcode scan. */
export function countScans(
  itemScans: string[] | null | undefined,
  sku: { sku: string; barcode: string | null; packs?: ScanPack[] },
): number {
  const keys = new Set([sku.sku, sku.barcode ?? ""].map((key) => key.trim().toUpperCase()).filter(Boolean));
  const packs = new Map(
    (sku.packs ?? []).flatMap((pack) => (pack.barcode?.trim() ? [[pack.barcode.trim().toUpperCase(), pack.qty] as const] : [])),
  );
  return (itemScans ?? []).reduce((sum, raw) => {
    const key = raw.trim().toUpperCase();
    return sum + (keys.has(key) ? 1 : (packs.get(key) ?? 0));
  }, 0);
}

type PostedSku = { sku: string; barcode: string | null; packs?: ScanPack[]; qty: number };

/** Posted qty per SKU, since one order can carry a SKU on two lines. */
function postedBySku(lines: ScanCheckLine[]): PostedSku[] {
  const bySku = new Map<string, PostedSku>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const key = line.sku.trim().toUpperCase();
    const posted = bySku.get(key);
    if (posted) posted.qty += line.qty;
    else bySku.set(key, { sku: line.sku, barcode: line.barcode, packs: line.packs, qty: line.qty });
  }
  return [...bySku.values()];
}

/** One scan the server recorded for a floor session. */
export type RecordedScan = {
  kind: string;
  code: string;
  sku?: string | null;
  serial?: string | null;
  locationId?: string | null;
  locationCode?: string | null;
  clientScanId?: string | null;
  /** Set once a post has used an item scan. Bay and plate scans are not consumed. */
  consumedAt?: number | null;
};

const BAY_KINDS = new Set(["location", "plate"]);

function scanSerial(scan: RecordedScan): string {
  return (scan.serial || (scan.kind === "serial" ? scan.code : "")).trim();
}

/** The serial that appears twice in the session, or null. Consumed scans still count. */
export function repeatedSerial(scans: RecordedScan[]): string | null {
  const seen = new Set<string>();
  for (const scan of scans) {
    const serial = scanSerial(scan);
    if (!serial) continue;
    const key = serial.toUpperCase();
    if (seen.has(key)) return serial;
    seen.add(key);
  }
  return null;
}

/** True when `serial` is already on a scan other than this client id. */
export function serialAlreadyRecorded(scans: RecordedScan[], serial: string, clientScanId?: string | null): boolean {
  const key = serial.trim().toUpperCase();
  if (!key) return false;
  return scans.some((scan) => scan.clientScanId !== clientScanId && scanSerial(scan).toUpperCase() === key);
}

/**
 * The evidence a post should trust: bay and plate scans, plus item scans not yet consumed.
 * A plate scan counts as its bay. Later bay scans replace earlier ones.
 */
export function evidenceFromRecordedScans(scans: RecordedScan[]): ScanEvidence {
  let locationScan: string | null = null;
  const itemScans: string[] = [];
  for (const scan of scans) {
    if (scan.kind === "location") locationScan = scan.locationCode || scan.code;
    else if (scan.kind === "plate") {
      if (scan.locationCode) locationScan = scan.locationCode;
    } else if (!BAY_KINDS.has(scan.kind) && !scan.consumedAt) {
      const code = (scan.sku || scan.code).trim();
      if (code) itemScans.push(code);
    }
  }
  return { locationScan, itemScans };
}

/**
 * Manufacturer posts must carry a session of server-recorded scans. Garage does not, and keeps the
 * client evidence path. A serial may be recorded once in the session.
 */
export function assertRecordedScans(
  policy: WorkflowPolicy,
  verb: ScanVerb,
  lines: ScanCheckLine[],
  scans: RecordedScan[] | null | undefined,
  bay?: { code: string; barcode: string } | null,
): void {
  if (!requiresScan(policy, verb)) return;
  if (!scans) {
    throw new WorkflowPolicyError(
      `Start a scan session before this ${verb}. Manufacturer mode records each scan on the server.`,
      "SCAN_REQUIRED",
    );
  }
  const repeat = repeatedSerial(scans);
  if (repeat) {
    throw new WorkflowPolicyError(`Serial ${repeat} was already scanned.`, "SCAN_REQUIRED");
  }
  assertScanned(policy, verb, lines, evidenceFromRecordedScans(scans), bay);
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
