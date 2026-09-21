import { describe, expect, it } from "vitest";
import {
  isLiveAggregator,
  liveShipAddress,
  mapAggregatorService,
  pickMatchingLiveRate,
  resolveParcel,
  shipEngineServiceCode,
} from "./carrier-live";

describe("live aggregator postage", () => {
  it("only treats live EasyPost and ShipEngine as live postage", () => {
    expect(isLiveAggregator("easypost", "live")).toBe(true);
    expect(isLiveAggregator("shipengine", "live")).toBe(true);
    expect(isLiveAggregator("easypost", "demo")).toBe(false);
    expect(isLiveAggregator("ups", "live")).toBe(false);
  });

  it("maps aggregator service names onto Rackline service ids", () => {
    expect(mapAggregatorService("UPS", "Ground")).toBe("ups_ground");
    expect(mapAggregatorService("UPS", "2nd Day Air")).toBe("ups_2day");
    expect(mapAggregatorService("FedEx", "Home Delivery")).toBe("fedex_home");
    expect(mapAggregatorService("USPS", "Priority")).toBe("usps_priority");
    expect(mapAggregatorService("DHLExpress", "Express Worldwide")).toBe("dhl_express");
    expect(mapAggregatorService("UPS", "ups_ground")).toBe("ups_ground");
    expect(shipEngineServiceCode("ups_2day")).toBe("ups_2nd_day_air");
    expect(shipEngineServiceCode("usps_priority")).toBe("usps_priority_mail");
  });

  it("requires a street city region postal for live labels and defaults the parcel", () => {
    expect(liveShipAddress({ name: "Northwind", text: "14 Dock St, Portland, OR 97209" })).toMatchObject({
      street1: "14 Dock St",
      city: "Portland",
      state: "OR",
      zip: "97209",
      country: "US",
    });
    expect(liveShipAddress({ name: "Northwind", text: "Portland, OR" })).toEqual(
      expect.objectContaining({ error: expect.stringContaining("street") }),
    );
    expect(resolveParcel({ weightOz: 0 })).toMatchObject({ weightOz: 16, lengthIn: 12 });
  });

  it("picks the cheapest matching live rate", () => {
    expect(
      pickMatchingLiveRate(
        [
          { serviceId: "ups_ground", amountCents: 1295, liveRateId: "r1" },
          { serviceId: "ups_ground", amountCents: 995, liveRateId: "r2" },
          { serviceId: "usps_priority", amountCents: 800, liveRateId: "r3" },
        ],
        "ups_ground",
      )?.liveRateId,
    ).toBe("r2");
    expect(pickMatchingLiveRate([{ serviceId: "usps_priority", amountCents: 800 }], "ups_ground")).toBeNull();
  });
});
