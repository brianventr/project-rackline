import { describe, expect, it } from "vitest";
import { channelSecret, openSecret, sealSecret } from "./secret-box";

describe("secret box", () => {
  it("round-trips a value and never stores it in the clear", async () => {
    const sealed = await sealSecret("s3cret-key-material", "ck_live_123");
    expect(sealed).toMatch(/^sb1:/);
    expect(sealed).not.toContain("ck_live_123");
    expect(await openSecret("s3cret-key-material", sealed)).toBe("ck_live_123");
  });

  it("returns null for a different secret, a plain value, or nothing", async () => {
    const sealed = await sealSecret("one", "token");
    expect(await openSecret("two", sealed)).toBeNull();
    expect(await openSecret("one", "token")).toBeNull();
    expect(await openSecret("one", null)).toBeNull();
    expect(await sealSecret("one", "")).toBeNull();
  });

  it("only falls back to a dev key on localhost", () => {
    const strong = "x".repeat(32);
    expect(channelSecret({ BETTER_AUTH_SECRET: strong })).toBe(strong);
    expect(channelSecret({ BETTER_AUTH_URL: "http://localhost:5173" })).toBeTruthy();
    expect(() => channelSecret({ BETTER_AUTH_URL: "https://rackline.example" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
