import { describe, expect, it } from "vitest";
import { garageAllowsPath, isGarageMode, parseOperatingMode } from "./operating-mode";

describe("operating mode", () => {
  it("accepts garage and warehouse", () => {
    expect(parseOperatingMode("garage")).toBe("garage");
    expect(parseOperatingMode("warehouse")).toBe("warehouse");
    expect(() => parseOperatingMode("maker")).toThrow(/garage or warehouse/);
  });

  it("treats only garage as Garage Mode", () => {
    expect(isGarageMode("garage")).toBe(true);
    expect(isGarageMode("warehouse")).toBe(false);
    expect(isGarageMode(undefined)).toBe(false);
  });

  it("keeps the founder bench and hides the leased warehouse", () => {
    expect(garageAllowsPath("/today")).toBe(true);
    expect(garageAllowsPath("/floor")).toBe(true);
    expect(garageAllowsPath("/floor/pick?id=o1")).toBe(true);
    expect(garageAllowsPath("/floor/kit")).toBe(true);
    expect(garageAllowsPath("/make/recipes")).toBe(true);
    expect(garageAllowsPath("/inbound/purchases/po1")).toBe(true);
    expect(garageAllowsPath("/outbound/orders/o1/pack-slip")).toBe(true);
    expect(garageAllowsPath("/map?edit=1")).toBe(true);
    expect(garageAllowsPath("/analytics/runway")).toBe(true);
    expect(garageAllowsPath("/stock")).toBe(true);
    expect(garageAllowsPath("/stock/items/sku1")).toBe(true);

    expect(garageAllowsPath("/floor/yard")).toBe(false);
    expect(garageAllowsPath("/floor/wave")).toBe(false);
    expect(garageAllowsPath("/floor/asn")).toBe(false);
    expect(garageAllowsPath("/floor/checkout")).toBe(false);
    expect(garageAllowsPath("/inbound/yard/y1")).toBe(false);
    expect(garageAllowsPath("/outbound/waves")).toBe(false);
    expect(garageAllowsPath("/stock/counts")).toBe(false);
    expect(garageAllowsPath("/stock/holds/h1")).toBe(false);
    expect(garageAllowsPath("/stock/replenish")).toBe(false);
    expect(garageAllowsPath("/equipment")).toBe(false);
    expect(garageAllowsPath("/analytics/traffic")).toBe(false);
    expect(garageAllowsPath("/setup/clients")).toBe(false);
    expect(garageAllowsPath("/setup/edi")).toBe(false);
    expect(garageAllowsPath("/labor")).toBe(false);
  });
});
