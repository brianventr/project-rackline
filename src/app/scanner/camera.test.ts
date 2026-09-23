import { describe, expect, it } from "vitest";
import { cameraFailureCopy, cameraFailureKind, cameraListed } from "./camera";

describe("cameraListed", () => {
  it("is true when a videoinput is listed", () => {
    expect(cameraListed([{ kind: "audioinput" }, { kind: "videoinput" }])).toBe(true);
  });

  it("is false when media is listed but no camera", () => {
    expect(cameraListed([{ kind: "audioinput" }, { kind: "audiooutput" }])).toBe(false);
  });

  it("is unknown when the list is empty or missing", () => {
    expect(cameraListed([])).toBeNull();
    expect(cameraListed(null)).toBeNull();
    expect(cameraListed(undefined)).toBeNull();
  });
});

describe("cameraFailureKind", () => {
  const named = (name: string) => Object.assign(new Error("raw browser text"), { name });

  it("reads a missing camera", () => {
    expect(cameraFailureKind(named("NotFoundError"))).toBe("missing");
    expect(cameraFailureKind(named("DevicesNotFoundError"))).toBe("missing");
    expect(cameraFailureKind(named("OverconstrainedError"))).toBe("missing");
  });

  it("reads a blocked camera", () => {
    expect(cameraFailureKind(named("NotAllowedError"))).toBe("blocked");
    expect(cameraFailureKind(named("PermissionDeniedError"))).toBe("blocked");
    expect(cameraFailureKind(named("SecurityError"))).toBe("blocked");
  });

  it("reads a busy camera", () => {
    expect(cameraFailureKind(named("NotReadableError"))).toBe("busy");
    expect(cameraFailureKind(named("TrackStartError"))).toBe("busy");
  });

  it("falls back to other", () => {
    expect(cameraFailureKind(named("AbortError"))).toBe("other");
    expect(cameraFailureKind(new Error("no name"))).toBe("other");
    expect(cameraFailureKind("text")).toBe("other");
    expect(cameraFailureKind(null)).toBe("other");
    expect(cameraFailureKind({ name: 42 })).toBe("other");
  });
});

describe("cameraFailureCopy", () => {
  it("points at the scan field when the screen has one", () => {
    expect(cameraFailureCopy("missing", true)).toEqual({ message: "No camera here.", hint: "Use the scan field or a scanner gun." });
    expect(cameraFailureCopy("blocked", true).hint).toBe(
      "Allow it in the browser settings, or use the scan field or a scanner gun.",
    );
  });

  it("points at a scanner gun when there is no scan field", () => {
    expect(cameraFailureCopy("missing", false)).toEqual({ message: "No camera here.", hint: "Use a scanner gun instead." });
    expect(cameraFailureCopy("busy", false)).toEqual({
      message: "Another app is using the camera.",
      hint: "Close that app and try again, or use a scanner gun.",
    });
    expect(cameraFailureCopy("other", false)).toEqual({ message: "Could not open the camera.", hint: "Try again, or use a scanner gun." });
  });

  it("never shows raw browser text or exclamation marks", () => {
    for (const kind of ["missing", "blocked", "busy", "other"] as const) {
      for (const field of [true, false]) {
        const copy = cameraFailureCopy(kind, field);
        expect(`${copy.message} ${copy.hint}`).not.toMatch(/!|Error|device not found/);
        expect(copy.message.endsWith(".")).toBe(true);
        expect(copy.hint.endsWith(".")).toBe(true);
      }
    }
  });
});
