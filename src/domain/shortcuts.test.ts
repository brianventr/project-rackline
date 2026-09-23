import { describe, expect, it } from "vitest";
import { INITIAL_SHORTCUT_STATE, readShortcut, type ShortcutState } from "./shortcuts";

function press(keys: [string, number][], options: { inField?: boolean } = {}) {
  let state: ShortcutState = INITIAL_SHORTCUT_STATE;
  const results = keys.map(([key, now]) => {
    const result = readShortcut(state, { key, now, inField: options.inField ?? false, modifier: false });
    state = result.state;
    return result;
  });
  return results.at(-1)!;
}

describe("readShortcut", () => {
  it("jumps on g then a page key typed by a person", () => {
    expect(press([["g", 1000], ["o", 1300]]).go).toBe("/outbound/orders");
    expect(press([["g", 1000], [",", 1200]]).go).toBe("/setup");
  });

  it("ignores the same keys when a scanner types them", () => {
    expect(press([["g", 1000], ["o", 1015]]).go).toBeUndefined();
    expect(press([["x", 1000], ["g", 1010], ["o", 1400]]).go).toBeUndefined();
  });

  it("expires the sequence and ignores unknown keys", () => {
    expect(press([["g", 1000], ["o", 3000]]).go).toBeUndefined();
    expect(press([["g", 1000], ["z", 1200]]).go).toBeUndefined();
  });

  it("does nothing while typing in a field", () => {
    expect(press([["g", 1000], ["o", 1300]], { inField: true }).go).toBeUndefined();
    expect(press([["?", 1000]], { inField: true }).help).toBeUndefined();
  });

  it("opens help and search", () => {
    expect(press([["?", 1000]]).help).toBe(true);
    expect(press([["/", 1000]]).search).toBe(true);
  });
});
