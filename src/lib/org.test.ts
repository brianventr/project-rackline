import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { requireOwner } from "./org";

describe("requireOwner", () => {
  it("allows owners and forbids operators", () => {
    expect(() => requireOwner("owner")).not.toThrow();
    try {
      requireOwner("operator");
      throw new Error("expected forbidden");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({ status: 403, message: "Owner role required" });
    }
    try {
      requireOwner(undefined);
    } catch (err) {
      expect(err).toMatchObject({ status: 403 });
    }
  });
});
