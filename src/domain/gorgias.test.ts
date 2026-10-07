import { describe, expect, it } from "vitest";
import { gorgiasWarrantyPayload, warrantyLabel } from "./gorgias";

describe("Gorgias warranty payload", () => {
  it("names eligibility from the ship date window", () => {
    expect(warrantyLabel(null)).toBe("No warranty");
    expect(warrantyLabel({ eligible: true, status: "active", end: Date.UTC(2027, 1, 15) })).toBe("Eligible until 2027-02-15");
    expect(warrantyLabel({ eligible: false, status: "void", end: Date.UTC(2027, 1, 15) })).toBe("Void");
  });

  it("puts the first match on the card and keeps the rest in the list", () => {
    const payload = gorgiasWarrantyPayload([
      {
        serial: "SN-1",
        serialStatus: "shipped",
        warranty: { eligible: true, status: "active", end: Date.UTC(2027, 0, 1) },
        order: { number: "ORD-1", customerName: "Ada", status: "shipped", trackingNumber: "1Z" },
        replacement: null,
      },
    ]);
    expect(payload.order).toBe("ORD-1");
    expect(payload.serial).toBe("SN-1");
    expect(payload.warranty).toBe("Eligible until 2027-01-01");
    expect(payload.tracking).toBe("1Z");
    expect(payload.matches).toHaveLength(1);
  });
});
