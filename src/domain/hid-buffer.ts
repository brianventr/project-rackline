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
  },
): HidKeyResult {
  const rapid = state.lastKeyAt > 0 && input.now - state.lastKeyAt <= HID_GAP_MS;

  if (input.key === "Enter") {
    if (input.inCapture) {
      return { action: "clear", state: { buffer: "", lastKeyAt: input.now } };
    }
    if (state.buffer.length >= HID_MIN_LEN && rapid) {
      return {
        action: "emit",
        value: state.buffer,
        state: { buffer: "", lastKeyAt: input.now },
      };
    }
    return { action: "clear", state: { buffer: "", lastKeyAt: input.now } };
  }

  if (input.key.length !== 1 || input.ctrlKey || input.metaKey || input.altKey) {
    return { action: "ignore", state };
  }

  if (!rapid && input.inField && !input.inCapture) {
    return { action: "clear", state: { buffer: "", lastKeyAt: input.now } };
  }

  const nextBuffer = rapid ? state.buffer + input.key : input.key;
  return {
    action: "append",
    state: { buffer: nextBuffer, lastKeyAt: input.now },
  };
}
