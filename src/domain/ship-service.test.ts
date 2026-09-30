import { describe, expect, it } from "vitest";
import { startingShipService } from "./ship-service";

describe("starting ship service", () => {
  const hub = {
    warehouseId: "w1",
    defaultService: { serviceId: "usps_priority" },
    enabledServices: [{ id: "ups_ground", isDefault: true }, { id: "usps_priority" }],
  };

  it("keeps the order's own service", () => {
    expect(startingShipService({ carrierService: "ups_ground", warehouseId: "w1" }, hub)).toBe("ups_ground");
  });

  it("uses the building default for an order in that building", () => {
    expect(startingShipService({ carrierService: null, warehouseId: "w1" }, hub)).toBe("usps_priority");
    expect(startingShipService({}, hub)).toBe("usps_priority");
  });

  it("skips another building's default", () => {
    expect(startingShipService({ warehouseId: "w2" }, hub)).toBe("ups_ground");
  });

  it("falls back to the default carrier, then Rackline Ground", () => {
    expect(startingShipService({ warehouseId: "w1" }, { ...hub, defaultService: null })).toBe("ups_ground");
    expect(startingShipService({ warehouseId: "w1" }, { warehouseId: "w1", enabledServices: [] })).toBe("rackline_ground");
    expect(startingShipService({ warehouseId: "w1" }, null)).toBe("rackline_ground");
  });
});
