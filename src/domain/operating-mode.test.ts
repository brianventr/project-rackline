import { describe, expect, it } from "vitest";
import {
  GARAGE_FIRST_HOUR_NAV,
  GARAGE_NAV,
  garageAllowsPath,
  garageNavForRole,
  garageOffersOnFloor,
  isGarageMode,
  manufacturerRedirect,
  parseOperatingMode,
} from "./operating-mode";
import { homePath } from "./home-path";

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
    expect(garageAllowsPath("/exceptions?tab=mine")).toBe(true);
    expect(garageAllowsPath("/welcome")).toBe(true);
    expect(garageAllowsPath("/welcome?step=racks")).toBe(true);
    expect(garageAllowsPath("/live")).toBe(true);
    expect(garageAllowsPath("/lab")).toBe(true);
    expect(garageAllowsPath("/lab?model=ax-1000")).toBe(true);
    expect(manufacturerRedirect("/lab")).toBeNull();
    expect(garageAllowsPath("/floor")).toBe(true);
    expect(garageAllowsPath("/floor/pick?id=o1")).toBe(true);
    expect(garageAllowsPath("/floor/kit")).toBe(true);
    expect(garageAllowsPath("/make/recipes")).toBe(true);
    expect(garageAllowsPath("/inbound/purchases/po1")).toBe(true);
    expect(garageAllowsPath("/inbound/vendors/v1")).toBe(true);
    expect(garageAllowsPath("/outbound/customers/c1")).toBe(true);
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
    expect(garageAllowsPath("/stock/plates")).toBe(false);
    expect(garageAllowsPath("/floor/plates?code=LP-000001")).toBe(false);
    expect(garageAllowsPath("/floor/exceptions")).toBe(false);
    expect(garageAllowsPath("/equipment")).toBe(false);
    expect(garageAllowsPath("/analytics/traffic")).toBe(false);
    expect(garageAllowsPath("/setup/clients")).toBe(false);
    expect(garageAllowsPath("/setup/edi")).toBe(false);
    expect(garageAllowsPath("/labor")).toBe(false);
  });

  it("keeps the maker menu short and on the same allowlist", () => {
    const urls = GARAGE_NAV.flatMap((group) => group.items.map((item) => item.url));
    expect(urls).toEqual([
      "/ship",
      "/today",
      "/exceptions",
      "/floor",
      "/map",
      "/inbound/purchases",
      "/inbound/vendors",
      "/inbound/receipts",
      "/make/recipes",
      "/make/schedule",
      "/make/work-orders",
      "/make/kits",
      "/outbound/orders",
      "/outbound/customers",
      "/outbound/returns",
      "/stock",
      "/stock/items",
      "/analytics/runway",
      "/analytics/restock",
      "/analytics/promise",
      "/automation",
      "/setup/shopify",
      "/setup/channels",
      "/setup/imports",
      "/setup/accounting",
      "/setup/carriers",
      "/setup/shipping-rules",
      "/setup/team",
      "/setup/labels",
      "/setup/warehouse",
    ]);
    for (const url of urls) expect(garageAllowsPath(url)).toBe(true);
    expect(garageNavForRole("operator").map((group) => group.label)).not.toContain("Shop");
    expect(garageNavForRole("owner").map((group) => group.label)).toContain("Shop");
    const firstHour = GARAGE_FIRST_HOUR_NAV.flatMap((group) => group.items.map((item) => item.url));
    expect(garageNavForRole("owner", { setupComplete: false }).flatMap((group) => group.items.map((item) => item.url))).toEqual(firstHour);
    expect(garageNavForRole("operator", { setupComplete: false }).flatMap((group) => group.items.map((item) => item.url))).toEqual(
      firstHour,
    );
    expect(garageNavForRole("owner", { setupComplete: true }).flatMap((group) => group.items.map((item) => item.url))).toEqual(urls);
    expect(urls).not.toContain("/stock/ledger");
    expect(urls).not.toContain("/inbound/putaway");
    expect(urls).not.toContain("/setup/audit");
    expect(urls).not.toContain("/map?edit=1");
    expect(garageAllowsPath("/stock/ledger")).toBe(true);
    expect(garageAllowsPath("/inbound/putaway/x1")).toBe(true);
    expect(garageAllowsPath("/setup/audit")).toBe(true);
  });

  it("ships from the queue and keeps floor pick, pack, and ship behind it", () => {
    expect(garageAllowsPath("/ship")).toBe(true);
    expect(garageAllowsPath("/ship/labels?ids=a,b")).toBe(true);
    expect(garageAllowsPath("/floor/pick?id=o1")).toBe(true);
    expect(garageOffersOnFloor("/floor/pick?id=o1")).toBe(false);
    expect(garageOffersOnFloor("/floor/pack")).toBe(false);
    expect(garageOffersOnFloor("/floor/ship")).toBe(false);
    expect(garageOffersOnFloor("/floor/receive")).toBe(true);
    expect(garageOffersOnFloor("/floor/wave")).toBe(false);
    expect(GARAGE_NAV[0]!.items[0]!.url).toBe("/ship");
  });

  it("sends Manufacturer from the ship queue to Waves and keeps the label page", () => {
    expect(manufacturerRedirect("/ship")).toBe("/outbound/waves");
    expect(manufacturerRedirect("/ship/?setup=box")).toBe("/outbound/waves");
    expect(manufacturerRedirect("/ship/labels?ids=a,b")).toBeNull();
    expect(manufacturerRedirect("/outbound/orders")).toBeNull();
    expect(manufacturerRedirect("/today")).toBeNull();
  });

  it("lands Garage on Ship and Manufacturer on Today or the floor", () => {
    expect(homePath("owner", "garage")).toBe("/ship");
    expect(homePath("operator", "garage")).toBe("/ship");
    expect(homePath("owner", "warehouse")).toBe("/today");
    expect(homePath("operator", "warehouse")).toBe("/floor");
    expect(homePath("operator")).toBe("/floor");
    expect(homePath("picker", "garage")).toBe("/floor");
    expect(homePath("bookkeeper", "garage")).toBe("/setup/accounting");
  });
});
