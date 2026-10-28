/** Device input preference, independent of whether any physical scanner is connected. */
export type ScannerInputMode = "touch" | "accessory";

export function parseScannerInputMode(raw: string | null | undefined): ScannerInputMode {
  return raw === "accessory" ? "accessory" : "touch";
}

/** Accessory mode keeps iPad's software keyboard out of the scanning workflow. */
export function scanFieldInputMode(mode: ScannerInputMode, manualEntry: boolean): "text" | "none" {
  return mode === "accessory" && !manualEntry ? "none" : "text";
}

/** Scan consumers use this timestamp as an identity; two scans must never share it. */
export function nextScanTimestamp(previous: number, now: number): number {
  return Math.max(previous + 1, now);
}
