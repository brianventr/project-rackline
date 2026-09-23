/** The page's scan field: an input marked `data-scan-capture` (FloorScanBox and friends). */

function reducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function scanCaptureInput(): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLInputElement>("input[data-scan-capture], [data-scan-capture] input");
}

/** Focus the page's scan field. Returns false when the page has none. */
export function focusScanCapture(): boolean {
  const input = scanCaptureInput();
  if (!input) return false;
  input.focus();
  input.select?.();
  input.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  return true;
}
