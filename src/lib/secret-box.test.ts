import { describe, expect, it } from "vitest";
import { channelSecret, isSealed, LOCAL_DEV_SECRET, openSecret, readStoredSecret, sealSecret, secretFingerprint } from "./secret-box";
import { resolveAuthSecret } from "./auth";

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

  it("tells a sealed value from plain text", async () => {
    expect(isSealed(await sealSecret("one", "token"))).toBe(true);
    expect(isSealed("shpat_1234")).toBe(false);
    expect(isSealed(null)).toBe(false);
  });

  it("reads a sealed credential and leaves it as stored", async () => {
    const sealed = await sealSecret("one", "shpat_live_1234");
    expect(await readStoredSecret("one", sealed)).toEqual({ value: "shpat_live_1234", reseal: null });
  });

  it("reads a plain credential from before sealing as is, and offers it sealed", async () => {
    const read = await readStoredSecret("one", "EZAK_plain_5678");
    expect(read.value).toBe("EZAK_plain_5678");
    expect(read.reseal).toMatch(/^sb1:/);
    expect(read.reseal).not.toContain("EZAK_plain_5678");
    expect(await openSecret("one", read.reseal)).toBe("EZAK_plain_5678");
  });

  it("reads a credential sealed under another secret as missing, and never reseals it", async () => {
    const sealed = await sealSecret("old-secret", "shpat_live_1234");
    expect(await readStoredSecret("new-secret", sealed)).toEqual({ value: null, reseal: null });
  });

  it("reads nothing as nothing", async () => {
    expect(await readStoredSecret("one", null)).toEqual({ value: null, reseal: null });
    expect(await readStoredSecret("one", "")).toEqual({ value: null, reseal: null });
  });

  it("fingerprints a secret without revealing it", async () => {
    const fp = await secretFingerprint("whsec_live");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain("whsec");
    expect(await secretFingerprint("whsec_live")).toBe(fp);
    expect(await secretFingerprint("other")).not.toBe(fp);
  });

  it("only falls back to a dev key on localhost, the same key sign-in uses", () => {
    const strong = "x".repeat(32);
    expect(channelSecret({ BETTER_AUTH_SECRET: strong })).toBe(strong);
    expect(channelSecret({ BETTER_AUTH_URL: "http://localhost:5173" })).toBe(LOCAL_DEV_SECRET);
    expect(channelSecret({}, "http://localhost:5175")).toBe(LOCAL_DEV_SECRET);
    expect(channelSecret({}, "http://127.0.0.1:5175")).toBe(resolveAuthSecret({}, "http://127.0.0.1:5175"));
    expect(() => channelSecret({})).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => channelSecret({ BETTER_AUTH_URL: "https://rackline.example" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => channelSecret({}, "https://rackline.example")).toThrow(/BETTER_AUTH_SECRET/);
  });
});
