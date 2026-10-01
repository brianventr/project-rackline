import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { badRequest, badRequestFrom, conflict, HttpError, requireInt, requireString } from "./http";

describe("http helpers", () => {
  it("requires a trimmed string", () => {
    expect(requireString("  dock  ", "location")).toBe("dock");
    expect(() => requireString("", "location")).toThrow(HttpError);
    expect(() => requireString(1, "location")).toThrow(/location is required/);
  });

  it("requires an integer", () => {
    expect(requireInt(4, "qty")).toBe(4);
    expect(requireInt("4", "qty")).toBe(4);
    expect(() => requireInt(1.5, "qty")).toThrow(/qty must be an integer/);
  });

  it("throws 400 and 409 with an optional code", () => {
    try {
      badRequest("SKU is required");
    } catch (err) {
      expect(err).toMatchObject({ status: 400, message: "SKU is required" });
    }
    try {
      conflict("Already on the team", "DUPLICATE");
    } catch (err) {
      expect(err).toMatchObject({ status: 409, message: "Already on the team", code: "DUPLICATE" });
    }
  });

  it("turns a domain error into a 400 but lets database failures and crashes through", () => {
    expect(() => badRequestFrom(new Error("Only 2 picked"), "Invalid unpick")).toThrow(
      expect.objectContaining({ status: 400, message: "Only 2 picked" }),
    );
    expect(() => badRequestFrom("boom", "Invalid unpick")).toThrow(
      expect.objectContaining({ status: 400, message: "Invalid unpick" }),
    );
    const failed = new DrizzleQueryError('update "order_lines" set "qty_picked" = ?', [2], new Error("D1_ERROR: x"));
    expect(() => badRequestFrom(failed, "Invalid unpick")).toThrow(failed);
    const crash = new TypeError("Cannot read properties of undefined");
    expect(() => badRequestFrom(crash, "Invalid unpick")).toThrow(crash);
  });
});
