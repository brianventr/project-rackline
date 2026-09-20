import { describe, expect, it } from "vitest";
import { buildShippingLabel, generateTrackingNumber, isCarrierService } from "./shipping-label";

describe("shipping labels", () => {
  it("mints RL tracking numbers", () => {
    expect(generateTrackingNumber("rackline_ground", () => "aaaaaaaa-bbbb-cccc-dddd-eeeeffffffff")).toBe(
      "RL-AAAAAAAABB",
    );
  });

  it("mints carrier-prefixed tracking", () => {
    const random = () => "aaaaaaaa-bbbb-cccc-dddd-eeeeffffffff";
    expect(generateTrackingNumber("ups_ground", random)).toBe("1ZAAAAAAAABB");
    expect(generateTrackingNumber("usps_priority", random)).toBe("9400AAAAAAAABB");
    expect(generateTrackingNumber("fedex_ground", random)).toBe("FE-AAAAAAAABB");
    expect(generateTrackingNumber("dhl_express", random)).toBe("DHL-AAAAAAAABB");
  });

  it("fills carrier and ship-to from the order", () => {
    const label = buildShippingLabel({
      id: "ord-1",
      number: "ORD-DEMO1",
      customerName: "Harbor Workshop",
      shipToAddress: "14 Dock St, Portland",
      carrierService: "ups_ground",
    });
    expect(label.carrierCompany).toBe("UPS");
    expect(label.carrierService).toBe("Ground");
    expect(label.shipToAddress).toBe("14 Dock St, Portland");
    expect(label.trackingNumber.startsWith("1Z")).toBe(true);
    expect(label.trackingUrl).toContain("ups.com/track");
    expect(isCarrierService("usps_priority")).toBe(true);
    expect(isCarrierService("fedex")).toBe(false);
    expect(isCarrierService("fedex_ground")).toBe(true);
  });

  it("keeps an existing tracking number", () => {
    const label = buildShippingLabel({
      id: "ord-2",
      number: "#1004",
      customerName: "Maya Chen",
      trackingNumber: "RL-EXISTING1",
      trackingCompany: "USPS",
      trackingUrl: "https://example.test/RL-EXISTING1",
      carrierService: "usps_priority",
    });
    expect(label.trackingNumber).toBe("RL-EXISTING1");
    expect(label.trackingUrl).toBe("https://example.test/RL-EXISTING1");
    expect(label.carrierCompany).toBe("USPS");
  });
});
