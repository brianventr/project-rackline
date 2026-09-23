import { HID_GAP_MS } from "./hid-buffer";

/** `g` then one of these keys jumps to a page. Kept small so it is learnable. */
export const GO_SHORTCUTS: Record<string, { path: string; label: string }> = {
  t: { path: "/today", label: "Today" },
  f: { path: "/floor", label: "Floor" },
  o: { path: "/outbound/orders", label: "Orders" },
  r: { path: "/inbound/receipts", label: "Receipts" },
  p: { path: "/inbound/purchases", label: "Purchases" },
  s: { path: "/stock", label: "On hand" },
  i: { path: "/stock/items", label: "Items" },
  b: { path: "/make/work-orders", label: "Work orders" },
  m: { path: "/map", label: "Map" },
  l: { path: "/stock/ledger", label: "Ledger" },
  ",": { path: "/setup", label: "Settings" },
};

/** Window for the second key after `g`. */
export const SEQUENCE_MS = 1500;

export type ShortcutState = { pendingAt: number | null; lastKeyAt: number };

export type ShortcutInput = {
  key: string;
  now: number;
  /** Focus is in an input, textarea, select, or contenteditable. */
  inField: boolean;
  modifier: boolean;
};

export type ShortcutResult = {
  state: ShortcutState;
  go?: string;
  help?: boolean;
  search?: boolean;
};

export const INITIAL_SHORTCUT_STATE: ShortcutState = { pendingAt: null, lastKeyAt: 0 };

/**
 * Keyboard shortcuts that never fire from a barcode gun. HID scanners type faster than
 * `HID_GAP_MS` per key, so any key that arrives that fast cancels a pending sequence.
 */
export function readShortcut(state: ShortcutState, input: ShortcutInput): ShortcutResult {
  const rapid = state.lastKeyAt > 0 && input.now - state.lastKeyAt <= HID_GAP_MS;
  const next: ShortcutState = { pendingAt: null, lastKeyAt: input.now };
  if (input.inField || input.modifier || rapid) return { state: next };
  if (input.key === "?") return { state: next, help: true };
  if (input.key === "/") return { state: next, search: true };
  const key = input.key.toLowerCase();
  if (state.pendingAt != null && input.now - state.pendingAt <= SEQUENCE_MS) {
    const target = GO_SHORTCUTS[key];
    if (target) return { state: next, go: target.path };
  }
  if (key === "g") return { state: { pendingAt: input.now, lastKeyAt: input.now } };
  return { state: next };
}
