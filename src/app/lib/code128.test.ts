import { describe, expect, it } from "vitest";
import { barcodeSvg, encodeCode128Bits } from "./code128";

describe("code 128 labels", () => {
  it("encodes location codes as bars plus a stop pattern", () => {
    const bits = encodeCode128Bits("A-01-01");
    expect(bits.endsWith("11")).toBe(true);
    expect(bits.length).toBeGreaterThan(40);
    expect([...bits].every((bit) => bit === "0" || bit === "1")).toBe(true);
    expect(barcodeSvg("RECV")).toContain("RECV");
  });
});
