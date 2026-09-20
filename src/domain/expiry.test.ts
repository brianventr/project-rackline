import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  assertLotNotExpired,
  assertSameLotExpiry,
  ExpiredLotError,
  formatExpiresOn,
  isExpiredLot,
  isExpiringLot,
  parseExpiresOn,
  requireExpiry,
  utcYyyymmdd,
} from "./expiry";

describe("expiry dates", () => {
  it("parses ISO and compact calendar days", () => {
    expect(parseExpiresOn("2026-09-20")).toBe(20260920);
    expect(parseExpiresOn(20260920)).toBe(20260920);
    expect(() => parseExpiresOn("2026-13-01")).toThrow("calendar date");
  });

  it("requires a date when the SKU tracks expiry", () => {
    expect(requireExpiry(false, "LED-BULB", undefined)).toBeNull();
    expect(requireExpiry(false, "LED-BULB", "2026-12-01")).toBe(20261201);
    expect(() => requireExpiry(true, "GLUE", undefined)).toThrow("GLUE requires an expiry date");
    expect(requireExpiry(true, "GLUE", "2026-12-01")).toBe(20261201);
  });

  it("formats and compares against UTC today", () => {
    expect(formatExpiresOn(20260920)).toBe("2026-09-20");
    expect(formatExpiresOn(null)).toBe("—");
    expect(isExpiredLot(20260101, 20260920)).toBe(true);
    expect(isExpiredLot(20260920, 20260920)).toBe(false);
    expect(isExpiringLot(addUtcDays(20260920, 14), 20260920)).toBe(true);
    expect(isExpiringLot(addUtcDays(20260920, 15), 20260920)).toBe(false);
  });

  it("rejects an expired lot code and a mismatched restock date", () => {
    expect(() => assertLotNotExpired("GLUE", "LOT-OLD", 20260101, 20260920)).toThrow(ExpiredLotError);
    expect(() => assertSameLotExpiry("GLUE", "LOT-A", 20261201, 20270101)).toThrow("already expires 2026-12-01");
    assertSameLotExpiry("GLUE", "LOT-A", 20261201, 20261201);
    expect(utcYyyymmdd(new Date("2026-09-20T23:00:00Z"))).toBe(20260920);
  });
});
