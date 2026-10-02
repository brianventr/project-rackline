import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOMATION_POLICY } from "../automation";
import { automationProblems } from "./automation";

const starved = {
  itemId: "bulb",
  sku: "LED-BULB",
  itemName: "LED bulb",
  pickMin: 20,
  pickQty: 2,
  toLocationId: "pick",
  toCode: "A-01-02",
  warehouseId: "wh",
};

const open = {
  id: "rpl-1",
  number: "RPL-1",
  sku: "LED-BULB",
  createdAt: 0,
  warehouseId: "wh",
  itemId: "bulb",
};

const low = {
  itemId: "bulb",
  sku: "LED-BULB",
  name: "LED bulb",
  onHand: 1,
  reorderPoint: 8,
};

describe("automation exceptions", () => {
  const base = {
    mode: "warehouse" as const,
    now: 8 * 3_600_000,
    warehouseId: "wh",
    starved: [starved],
    openReplenishments: [open],
    lowStock: [low],
  };

  it("stays quiet on the defaults", () => {
    expect(automationProblems({ ...base, policy: DEFAULT_AUTOMATION_POLICY })).toEqual([]);
  });

  it("lists starved faces, overdue replenishments, and reorder points when those branches are on", () => {
    const items = automationProblems({
      ...base,
      policy: {
        replenishMode: "suggest",
        bulkGap: "exception",
        remindOpenAfterHours: 8,
        reorderAlert: "exception",
      },
    });
    expect(items.map((item) => item.kind)).toEqual(["starved-pick", "replenish-reminder", "reorder"]);
    expect(items[0]?.link).toBe("/stock/replenish");
    expect(items[1]?.link).toBe("/stock/replenish/rpl-1");
    expect(items[2]?.ownerOnly).toBe(true);
    expect(items[2]?.link).toBe("/today");
  });

  it("keeps garage links on screens the bench can open", () => {
    const [item] = automationProblems({
      ...base,
      mode: "garage",
      policy: { ...DEFAULT_AUTOMATION_POLICY, bulkGap: "exception" },
      openReplenishments: [],
      lowStock: [],
    });
    expect(item?.link).toBe("/stock/items/bulb");
    expect(item?.floorLink).toBeNull();
  });
});
