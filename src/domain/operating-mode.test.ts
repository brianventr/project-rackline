import { describe, expect, it } from "vitest";
import { GARAGE_NAV, garageAllowsPath, garageNavForRole, isGarageMode, parseOperatingMode } from "./operating-mode";

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
    expect(garageAllowsPath("/welcome")).toBe(true);
    expect(garageAllowsPath("/welcome?step=racks")).toBe(true);
    expect(garageAllowsPath("/live")).toBe(true);
    expect(garageAllowsPath("/floor")).toBe(true);
    expect(garageAllowsPath("/floor/pick?id=o1")).toBe(true);
    expect(garageAllowsPath("/floor/kit")).toBe(true);
    expect(garageAllowsPath("/make/recipes")).toBe(true);
    expect(garageAllowsPath("/inbound/purchases/po1")).toBe(true);
    expect(garageAllowsPath("/outbound/orders/o1/pack-slip")).toBe(true);
    expect(garageAllowsPath("/map?edit=1")).toBe(true);
    expect(garageAllowsPath("/analytics/runway")).toBe(true);
    expect(garageAllowsPath("/analytics/promise")).toBe(true);
    expect(garageAllowsPath("/stock")).toBe(true);
    expect(garageAllowsPath("/setup/team")).toBe(true);
    expect(garageAllowsPath("/setup/audit")).toBe(true);

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

  it("keeps the maker menu short and on the same allowlist", () => {
    const urls = GARAGE_NAV.flatMap((group) => group.items.map((item) => item.url));
    expect(urls).toEqual([
      "/today",
      "/floor",
      "/map",
      "/inbound/purchases",
      "/inbound/receipts",
      "/make/recipes",
      "/make/work-orders",
      "/make/kits",
      "/outbound/orders",
      "/outbound/returns",
      "/stock",
      "/stock/items",
      "/analytics/runway",
      "/analytics/promise",
      "/setup/shopify",
      "/setup/carriers",
      "/setup/team",
      "/setup/labels",
      "/setup/warehouse",
    ]);
    for (const url of urls) expect(garageAllowsPath(url)).toBe(true);
    expect(garageNavForRole("operator").map((group) => group.label)).not.toContain("Shop");
    expect(garageNavForRole("owner").map((group) => group.label)).toContain("Shop");
    expect(urls).not.toContain("/stock/ledger");
    expect(urls).not.toContain("/inbound/putaway");
    expect(urls).not.toContain("/setup/audit");
    expect(urls).not.toContain("/map?edit=1");
    expect(garageAllowsPath("/stock/ledger")).toBe(true);
    expect(garageAllowsPath("/inbound/putaway/x1")).toBe(true);
    expect(garageAllowsPath("/setup/audit")).toBe(true);
  });
});
