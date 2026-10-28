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

  it("does not turn fast typing in a quantity, search, or note field into a scan", () => {
    let state = { buffer: "", lastKeyAt: 0 };
    for (const [index, key] of [..."12345", "Enter"].entries()) {
      const result = accumulateHidKey(state, { key, now: 1000 + index * 5, inCapture: false, inField: true });
      expect(result.action).toBe("clear");
      state = result.state;
    }
    expect(state.buffer).toBe("");
  });

  it("leaves explicit capture fields in charge even for a slow accessory scanner", () => {
    let state = { buffer: "OLD", lastKeyAt: 1000 };
    for (const [index, key] of [..."BIN:A-01", "Enter"].entries()) {
      const result = accumulateHidKey(state, { key, now: 1100 + index * 100, inCapture: true, inField: true });
      expect(result.action).toBe("clear");
      state = result.state;
    }
    expect(state.buffer).toBe("");
  });

  it("discards partial scans when editing, using a shortcut, composing, or holding a key", () => {
    for (const extra of [{ inField: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) {
      const result = accumulateHidKey({ buffer: "BIN", lastKeyAt: 1000 }, {
        key: "X", now: 1010, inCapture: false, inField: false, ...extra,
      });
      expect(result.action).toBe("clear");
      expect(result.state.buffer).toBe("");
      expect(accumulateHidKey(result.state, { key: "Enter", now: 1020, inCapture: false, inField: false }).action).toBe("clear");
    }
  });

  it("does not emit a stalled scan or consume ordinary Tab navigation", () => {
    const state = { buffer: "BIN:A-01", lastKeyAt: 1000 };
    expect(accumulateHidKey(state, { key: "Enter", now: 1200, inCapture: false, inField: false }).action).toBe("clear");
    expect(accumulateHidKey(state, { key: "Tab", now: 1010, inCapture: false, inField: false }).action).toBe("ignore");
  });
});
