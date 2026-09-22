import { describe, expect, it } from "vitest";
import { badRequest, conflict, HttpError, requireInt, requireString } from "./http";

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
});
