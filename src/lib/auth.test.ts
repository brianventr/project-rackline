import { describe, expect, it } from "vitest";
import { resolveAuthSecret } from "./auth";

describe("auth secret", () => {
  it("uses the env secret when it is long enough", () => {
    expect(resolveAuthSecret({ BETTER_AUTH_SECRET: "x".repeat(32) }, "https://rackline.example")).toBe(
      "x".repeat(32),
    );
  });

  it("falls back only on localhost", () => {
    expect(resolveAuthSecret({}, "http://localhost:5173").length).toBeGreaterThanOrEqual(32);
    expect(() => resolveAuthSecret({}, "https://rackline.example")).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthSecret({ BETTER_AUTH_SECRET: "short" }, "https://rackline.example")).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});
