import { describe, expect, it } from "vitest";
import { accumulateHidKey, HID_MIN_LEN } from "./hid-buffer";

describe("hid buffer", () => {
  it("emits on rapid Enter after enough chars", () => {
    let state = { buffer: "", lastKeyAt: 0 };
    const now = 1_000;
    for (const key of "ABC") {
      const result = accumulateHidKey(state, { key, now: now + 10, inCapture: false, inField: false });
      expect(result.action).toBe("append");
      state = result.state;
    }
    const emit = accumulateHidKey(state, { key: "Enter", now: now + 20, inCapture: false, inField: false });
    expect(emit.action).toBe("emit");
    if (emit.action === "emit") expect(emit.value).toBe("ABC");
  });

  it("clears without emit inside data-scan-capture", () => {
    const state = { buffer: "ABCD", lastKeyAt: 1_000 };
    const result = accumulateHidKey(state, { key: "Enter", now: 1_010, inCapture: true, inField: true });
    expect(result.action).toBe("clear");
    expect(result.state.buffer).toBe("");
  });

  it("ignores slow typing in normal fields", () => {
    const state = { buffer: "A", lastKeyAt: 1_000 };
    const result = accumulateHidKey(state, { key: "B", now: 1_200, inCapture: false, inField: true });
    expect(result.action).toBe("clear");
  });

  it("requires min length before emit", () => {
    expect(HID_MIN_LEN).toBe(3);
    const state = { buffer: "AB", lastKeyAt: 1_000 };
    const result = accumulateHidKey(state, { key: "Enter", now: 1_010, inCapture: false, inField: false });
    expect(result.action).toBe("clear");
  });
});
