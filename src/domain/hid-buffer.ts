/** Pure HID keyboard-wedge buffer rules for gun scanners. */

export const HID_GAP_MS = 40;
export const HID_MIN_LEN = 3;

export type HidBufferState = {
  buffer: string;
  lastKeyAt: number;
};

export type HidKeyResult =
  | { action: "ignore"; state: HidBufferState }
  | { action: "clear"; state: HidBufferState }
  | { action: "append"; state: HidBufferState }
  | { action: "emit"; value: string; state: HidBufferState };

export function accumulateHidKey(
  state: HidBufferState,
  input: {
    key: string;
    now: number;
    inCapture: boolean;
    inField: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    isComposing?: boolean;
    repeat?: boolean;
  },
): HidKeyResult {
  // Marked scan fields own their Enter and accept scanners at any typing speed. Other
  // editable fields belong to the person typing: never turn their input into a scan.
  if (input.inCapture || input.inField || input.isComposing || input.repeat || input.ctrlKey || input.metaKey || input.altKey) {
    return { action: "clear", state: { buffer: "", lastKeyAt: 0 } };
  }
  const rapid = state.lastKeyAt > 0 && input.now - state.lastKeyAt <= HID_GAP_MS;

  if (input.key === "Enter") {
    if (state.buffer.length >= HID_MIN_LEN && rapid) {
      return {
        action: "emit",
        value: state.buffer,
        state: { buffer: "", lastKeyAt: input.now },
      };
    }
    return { action: "clear", state: { buffer: "", lastKeyAt: input.now } };
  }

  if (input.key.length !== 1) {
    return { action: "ignore", state };
  }

  const nextBuffer = rapid ? state.buffer + input.key : input.key;
  return {
    action: "append",
    state: { buffer: nextBuffer, lastKeyAt: input.now },
  };
}
