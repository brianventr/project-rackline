import type { ScanHit } from "../../api";
import type { ScanEvidence } from "@/domain/workflow-policy";

/** What the operator actually scanned since the last post; sent as proof in Manufacturer mode. */
export type ScanLog = {
  locationId: string | null;
  locationCode: string | null;
  /** Set when a license plate was scanned instead of its bay; the bay fields are the plate's bay. */
  plateCode: string | null;
  /** Pick keeps each SKU once. Pack keeps one entry per unit, so a SKU repeats. */
  skus: string[];
  /** Serials pack already counted, so scanning one twice is not two units. */
  serials: string[];
};

export const EMPTY_SCAN_LOG: ScanLog = { locationId: null, locationCode: null, plateCode: null, skus: [], serials: [] };

export function recordScan(log: ScanLog, hit: ScanHit): ScanLog {
  if (hit.kind === "location") return { ...log, locationId: hit.location.id, locationCode: hit.location.code, plateCode: null };
  if (hit.kind === "plate") {
    return { ...log, locationId: hit.plate.locationId, locationCode: hit.plate.locationCode, plateCode: hit.plate.code };
  }
  const skus =
    hit.kind === "item"
      ? [hit.item.sku]
      : hit.kind === "serial"
        ? [hit.serial.sku]
        : hit.kind === "lot"
          ? [...new Set(hit.onHand.map((row) => row.sku))]
          : [];
  if (!skus.length) return log;
  return { ...log, skus: [...new Set([...log.skus, ...skus])] };
}

/** Pack counts units, so each unit scan adds its SKU again. */
export function recordUnitScan(log: ScanLog, unit: { sku: string; serial?: string | null }): ScanLog {
  return {
    ...log,
    skus: [...log.skus, unit.sku],
    serials: unit.serial ? [...log.serials, unit.serial] : log.serials,
  };
}

/** Keeps the bay (the operator is still standing there) and clears the SKUs a post used. */
export function afterPost(log: ScanLog): ScanLog {
  return { ...log, skus: [], serials: [] };
}

/** The bay counts only when it is the bay being posted from. */
export function scanEvidence(log: ScanLog, bayId?: string | null): ScanEvidence {
  return {
    locationScan: bayId && log.locationId === bayId ? log.locationCode : null,
    itemScans: log.skus,
  };
}

/** The plate a pick from `bayId` comes off: the one scanned in that bay, if any. */
export function scannedPlate(log: ScanLog, bayId?: string | null): string | null {
  return bayId && log.locationId === bayId ? log.plateCode : null;
}
