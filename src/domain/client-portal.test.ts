import { describe, expect, it } from "vitest";
import { clientRunwayDays } from "./client-portal";

describe("clientRunwayDays", () => {
  it("divides this client's on-hand by their shipped daily rate", () => {
    expect(clientRunwayDays(60, 30, 30)).toBe(60);
    expect(clientRunwayDays(10, 0, 30)).toBeNull();
    expect(clientRunwayDays(0, 30, 30)).toBe(0);
  });
});
