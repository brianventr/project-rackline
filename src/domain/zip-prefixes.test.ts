import { describe, expect, it } from "vitest";
import { usZipPrefix, usZipPrefixInState } from "./zip-prefixes";

describe("US ZIP prefixes", () => {
  it("reads the 3-digit prefix from a ZIP or ZIP+4", () => {
    expect(usZipPrefix("98101")).toBe(981);
    expect(usZipPrefix("97209-1234")).toBe(972);
    expect(usZipPrefix("00501")).toBe(5);
    expect(usZipPrefix("9720")).toBeNull();
  });

  it("rejects a Seattle ZIP in Oregon and accepts it in Washington", () => {
    expect(usZipPrefixInState("98101", "OR")).toBe(false);
    expect(usZipPrefixInState("98101", "WA")).toBe(true);
    expect(usZipPrefixInState("97209", "OR")).toBe(true);
    expect(usZipPrefixInState("97209", "WA")).toBe(false);
  });

  it("keeps prefixes that cross the old first-digit groups", () => {
    expect(usZipPrefixInState("88510", "TX")).toBe(true);
    expect(usZipPrefixInState("88510", "NM")).toBe(false);
    expect(usZipPrefixInState("11201", "NY")).toBe(true);
    expect(usZipPrefixInState("07209", "OR")).toBe(false);
    expect(usZipPrefixInState("07209", "NJ")).toBe(true);
    expect(usZipPrefixInState("00501", "NY")).toBe(true);
    expect(usZipPrefixInState("96910", "GU")).toBe(true);
  });
});
