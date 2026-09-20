import { describe, expect, it } from "vitest";
import { asnHandoffPatch, canReceiveLinkedAsn, nextYardStatus, yardLabel } from "./yard";

describe("yard", () => {
  it("walks expected → checked_in → at_dock → checked_out", () => {
    expect(nextYardStatus("expected", "check_in")).toBe("checked_in");
    expect(nextYardStatus("checked_in", "assign_dock")).toBe("at_dock");
    expect(nextYardStatus("at_dock", "check_out")).toBe("checked_out");
    expect(nextYardStatus("expected", "check_out")).toBeNull();
  });

  it("labels visits with trailer when present", () => {
    expect(yardLabel({ number: "YRD-1", carrierName: "UPS", trailerNumber: "T-9" })).toBe("YRD-1 · UPS / T-9");
    expect(yardLabel({ number: "YRD-1", carrierName: "UPS" })).toBe("YRD-1 · UPS");
  });

  it("handoffs ASN to dock and gates receive-asn", () => {
    expect(asnHandoffPatch({ asnId: "a1", dockLocationId: "dock", currentAsnStatus: "draft" })).toEqual({
      asnId: "a1",
      locationId: "dock",
      status: "expected",
    });
    expect(canReceiveLinkedAsn({ asnId: "a1", status: "at_dock", dockLocationId: "dock" })).toBe(true);
    expect(canReceiveLinkedAsn({ asnId: null, status: "at_dock", dockLocationId: "dock" })).toBe(false);
  });
});
