import { api, type ScanHit } from "../../api";
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

export type ScanTask = "pick" | "pack" | "batch-pick";

/** One scan sent to POST /api/floor/scans. `clientScanId` makes a retry the same scan. */
export type ServerScan = {
  clientScanId: string;
  kind: "location" | "plate" | "item" | "serial" | "lot";
  code: string;
  sku: string | null;
  serial: string | null;
  locationId: string | null;
  locationCode: string | null;
};

let scanSeq = 0;
function clientScanId(): string {
  scanSeq += 1;
  return `c${Date.now().toString(36)}${scanSeq}`;
}

/** A lookup hit as the server should record it. Orders and other documents are not scans. */
export function serverScanFromHit(hit: ScanHit): ServerScan | null {
  const id = clientScanId();
  if (hit.kind === "location") {
    return {
      clientScanId: id,
      kind: "location",
      code: hit.location.code,
      sku: null,
      serial: null,
      locationId: hit.location.id,
      locationCode: hit.location.code,
    };
  }
  if (hit.kind === "plate") {
    return {
      clientScanId: id,
      kind: "plate",
      code: hit.plate.code,
      sku: null,
      serial: null,
      locationId: hit.plate.locationId,
      locationCode: hit.plate.locationCode,
    };
  }
  if (hit.kind === "item") {
    return {
      clientScanId: id,
      kind: "item",
      code: hit.pack?.barcode || hit.item.barcode || hit.item.sku,
      sku: hit.item.sku,
      serial: null,
      locationId: null,
      locationCode: null,
    };
  }
  if (hit.kind === "serial") {
    return {
      clientScanId: id,
      kind: "serial",
      code: hit.serial.serialCode,
      sku: hit.serial.sku,
      serial: hit.serial.serialCode,
      locationId: hit.serial.locationId,
      locationCode: hit.serial.locationCode,
    };
  }
  if (hit.kind === "lot") {
    return {
      clientScanId: id,
      kind: "lot",
      code: hit.lotCode,
      sku: hit.onHand[0]?.sku ?? null,
      serial: null,
      locationId: null,
      locationCode: null,
    };
  }
  return null;
}

/** One server scan per unit. A pack barcode is `times` scans of the SKU, matching the local log. */
export function serverScansFromUnit(unit: { sku: string; serial?: string | null }, times = 1): ServerScan[] {
  return Array.from({ length: Math.max(0, times) }, () => ({
    clientScanId: clientScanId(),
    kind: unit.serial ? ("serial" as const) : ("item" as const),
    code: unit.serial || unit.sku,
    sku: unit.sku,
    serial: unit.serial ?? null,
    locationId: null,
    locationCode: null,
  }));
}

/**
 * Records scans as they happen and flushes them before a post. A failed send stays failed so the
 * post does not pretend the server saw the scan. Reopening the same task reuses the session.
 */
export function createScanRecorder(task: ScanTask, refId: () => string | null) {
  let sessionId: string | null = null;
  let boundRef: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  let failed: Error | null = null;

  async function ensure(): Promise<string> {
    const ref = refId();
    if (!ref) throw new Error("Open the floor task before scanning");
    if (sessionId && boundRef === ref) return sessionId;
    const opened = await api<{ id: string }>("/api/floor/scan-sessions", {
      method: "POST",
      body: JSON.stringify({ task, refId: ref }),
    });
    sessionId = opened.id;
    boundRef = ref;
    return opened.id;
  }

  return {
    record(scan: ServerScan | null) {
      if (!scan || !refId()) return;
      chain = chain.then(async () => {
        if (failed) return;
        try {
          const id = await ensure();
          await api("/api/floor/scans", { method: "POST", body: JSON.stringify({ sessionId: id, ...scan }) });
        } catch (err) {
          failed = err instanceof Error ? err : new Error("Scan was not recorded");
        }
      });
    },
    recordMany(scans: ServerScan[]) {
      for (const scan of scans) this.record(scan);
    },
    async flush(): Promise<string | null> {
      await chain;
      if (failed) throw failed;
      return sessionId;
    },
  };
}
