/**
 * Pure helpers for the camera scanner: whether this device lists a camera, and plain copy for
 * when the camera will not open. No React or DOM here, so vitest covers it.
 */

/** Why the camera did not open, from the error `getUserMedia` (or `play`) threw. */
export type CameraFailure = "missing" | "blocked" | "busy" | "other";

/**
 * From `navigator.mediaDevices.enumerateDevices()`: true when a camera is listed, false when the
 * device lists other media but no camera, and null when the list says nothing (empty or missing),
 * which some browsers return before the person has allowed media access.
 */
export function cameraListed(devices: readonly { kind: string }[] | null | undefined): boolean | null {
  if (!devices || devices.length === 0) return null;
  return devices.some((device) => device.kind === "videoinput");
}

export function cameraFailureKind(err: unknown): CameraFailure {
  const name =
    err && typeof err === "object" && "name" in err && typeof (err as { name: unknown }).name === "string"
      ? (err as { name: string }).name
      : "";
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "missing";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "blocked";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    default:
      return "other";
  }
}

/**
 * What to tell the person when the camera will not open. `hasScanField` is true when the screen
 * has a scan field (it gets focus), so the fix can point at it.
 */
export function cameraFailureCopy(kind: CameraFailure, hasScanField: boolean): { message: string; hint: string } {
  const fallback = hasScanField ? "use the scan field or a scanner gun" : "use a scanner gun";
  switch (kind) {
    case "missing":
      return { message: "No camera here.", hint: hasScanField ? "Use the scan field or a scanner gun." : "Use a scanner gun instead." };
    case "blocked":
      return { message: "Camera access is off for this site.", hint: `Allow it in the browser settings, or ${fallback}.` };
    case "busy":
      return { message: "Another app is using the camera.", hint: `Close that app and try again, or ${fallback}.` };
    default:
      return { message: "Could not open the camera.", hint: `Try again, or ${fallback}.` };
  }
}
