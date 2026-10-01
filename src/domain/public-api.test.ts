import { describe, expect, it } from "vitest";
import { decodePageCursor, encodePageCursor, parseApiScopes, parsePageLimit, storedScopes } from "./public-api";

describe("public api pages", () => {
  it("round-trips a cursor without an internal id", () => {
    const cursor = encodePageCursor(["1710000000000", "ORD-1"]);
    expect(cursor).not.toContain("ORD-1");
    expect(decodePageCursor(cursor, 2)).toEqual(["1710000000000", "ORD-1"]);
    expect(decodePageCursor("nope", 2)).toBeNull();
  });

  it("caps a page at 50", () => {
    expect(parsePageLimit(undefined)).toBe(50);
    expect(parsePageLimit("10")).toBe(10);
    expect(parsePageLimit("500")).toBe(50);
    expect(parsePageLimit("0")).toBe(50);
  });

  it("accepts only the read scopes", () => {
    expect(parseApiScopes(["orders:read", "stock:read"])).toEqual(["orders:read", "stock:read"]);
    expect(() => parseApiScopes(["orders:write"])).toThrow(/scope/i);
    expect(storedScopes('["orders:read","nope"]')).toEqual(["orders:read"]);
  });
});
