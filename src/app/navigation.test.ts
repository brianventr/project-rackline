import { describe, expect, it } from "vitest";
import { MODULES } from "@/domain/modules";
import { OFFICE_NAV, isNavActive, navForSession, settingsForSession } from "./navigation";

describe("office modules", () => {
  it("follows the pipe, with Now and Building around it", () => {
    expect(OFFICE_NAV.map((group) => group.label)).toEqual(MODULES.map((module) => module.label));
  });

  it("puts each former analytics page on the stage it answers", () => {
    const at = (url: string) => OFFICE_NAV.find((group) => group.items.some((item) => item.url === url))?.label;
    expect(at("/analytics/restock")).toBe("Inbound");
    expect(at("/analytics/runway")).toBe("Inventory");
    expect(at("/analytics/recall")).toBe("Inventory");
    expect(at("/analytics/promise")).toBe("Outbound");
    expect(at("/analytics/traffic")).toBe("Outbound");
    expect(at("/outbound/returns")).toBe("Returns");
    expect(at("/inbound/vendor-returns")).toBe("Returns");
    expect(at("/automation")).toBeUndefined();
  });

  it("keeps the old names as search words", () => {
    const item = (url: string) => OFFICE_NAV.flatMap((group) => group.items).find((row) => row.url === url);
    expect(item("/stock")?.keywords).toMatch(/stock/);
    expect(item("/analytics/runway")?.keywords).toMatch(/analytics/);
    expect(item("/outbound/returns")?.keywords).toMatch(/rma/);
    expect(item("/inbound/vendor-returns")?.keywords).toMatch(/rtv/);
  });
});

describe("navForSession", () => {
  it("gives Manufacturer the pipe plus Settings, and hides owner-only items from operators", () => {
    const owner = navForSession("owner", false);
    expect(owner.map((group) => group.label)).toEqual([...MODULES.map((module) => module.label), "Setup"]);
    expect(owner.at(-1)?.bare).toBe(true);
    expect(owner.at(-1)?.items.map((item) => item.title)).toEqual(["Settings"]);
    const operator = navForSession("operator", false);
    expect(operator.map((group) => group.label)).toEqual(MODULES.map((module) => module.label));
    expect(operator.flatMap((group) => group.items).some((item) => item.url === "/live")).toBe(false);
    expect(operator.flatMap((group) => group.items).some((item) => item.url === "/map?edit=1")).toBe(false);
  });

  it("uses the same module names in Garage, and keeps the first hour to ship, items, and receive", () => {
    const owner = navForSession("owner", true, { setupComplete: true });
    expect(owner.map((group) => group.label)).toEqual(["Now", "Inbound", "Inventory", "Make", "Outbound", "Returns", "Shop"]);
    expect(owner.at(-1)?.bare).toBe(true);
    const first = navForSession("owner", true, { setupComplete: false });
    expect(first[0]?.bare).toBe(true);
    expect(first.flatMap((group) => group.items).map((item) => item.url)).toEqual([
      "/ship",
      "/stock/items",
      "/inbound/receipts",
      "/setup",
    ]);
  });

  it("splits role menus onto the same modules", () => {
    expect(navForSession("viewer", false).map((group) => group.label)).toEqual(["Now", "Inventory", "Outbound"]);
    expect(navForSession("bookkeeper", false).map((group) => group.label)).toEqual(["Inbound", "Inventory", "Accounting"]);
    expect(navForSession("support", false).map((group) => group.label)).toEqual(["Returns"]);
    expect(navForSession("picker", false).flatMap((group) => group.items).map((item) => item.url)).toEqual(["/floor"]);
    expect(navForSession("picker", false)[0]?.bare).toBe(true);
  });

  it("lists Automation in Settings, next to shipping rules", () => {
    const urls = settingsForSession("owner", false).map((item) => item.url);
    const rules = urls.indexOf("/setup/shipping-rules");
    expect(urls[rules + 1]).toBe("/automation");
    expect(settingsForSession("owner", true).some((item) => item.url === "/automation")).toBe(true);
    expect(isNavActive("/automation", "", "/setup")).toBe(true);
    expect(isNavActive("/analytics/traffic", "", "/setup")).toBe(false);
  });
});
