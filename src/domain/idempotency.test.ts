import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_IN_PROGRESS, IdempotencyKeyError, idempotencyKeyFrom } from "./idempotency";

describe("idempotencyKeyFrom", () => {
  it("treats a missing or blank key as no key", () => {
    expect(idempotencyKeyFrom(undefined, undefined)).toBeNull();
    expect(idempotencyKeyFrom(null, null)).toBeNull();
    expect(idempotencyKeyFrom("  ", undefined)).toBeNull();
    expect(idempotencyKeyFrom(undefined, "  ")).toBeNull();
  });

  it("keeps a client key and trims it", () => {
    expect(idempotencyKeyFrom("  recv-key-1 ", undefined)).toBe("recv-key-1");
    expect(idempotencyKeyFrom(undefined, "pick_key.2")).toBe("pick_key.2");
    expect(idempotencyKeyFrom(undefined, "11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("lets the header win when the body also has a key", () => {
    expect(idempotencyKeyFrom("from-header", "from-body")).toBe("from-header");
  });

  it("refuses a key that would not round-trip", () => {
    expect(() => idempotencyKeyFrom("has space", undefined)).toThrow(IdempotencyKeyError);
    expect(() => idempotencyKeyFrom("a/b", undefined)).toThrow(IdempotencyKeyError);
    expect(() => idempotencyKeyFrom("a".repeat(129), undefined)).toThrow(IdempotencyKeyError);
    expect(() => idempotencyKeyFrom(undefined, 12)).toThrow(IdempotencyKeyError);
  });

  it("names the in-progress replay", () => {
    expect(IDEMPOTENCY_IN_PROGRESS).toBe("IDEMPOTENCY_IN_PROGRESS");
  });
});
