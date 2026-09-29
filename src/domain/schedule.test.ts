import { describe, expect, it } from "vitest";
import { rankScheduleJobs, toScheduleJob } from "./schedule";
import { buildValuationRows, valuationToCsv } from "./accounting-export";
import { parseChannelCsv, groupChannelRows } from "./channel-import";
import { buildRecallSummary } from "./recall";

describe("schedule board", () => {
  it("ranks older larger jobs first", () => {
    const now = 1_000_000;
    const a = toScheduleJob({
      id: "1",
      kind: "kit",
      number: "KIT-1",
      sku: "LAMP",
      name: "Lamp",
      qty: 10,
      qtyCompleted: 0,
      status: "in_progress",
      createdAt: now - 10 * 3_600_000,
      now,
    })!;
    const b = toScheduleJob({
      id: "2",
      kind: "work_order",
      number: "WO-1",
      sku: "BASE",
      name: "Base",
      qty: 2,
      qtyCompleted: 0,
      status: "open",
      createdAt: now - 1 * 3_600_000,
      now,
    })!;
    expect(rankScheduleJobs([b, a])[0]?.number).toBe("KIT-1");
  });
});

describe("accounting export", () => {
  it("builds valuation csv", () => {
    const rows = buildValuationRows([
      { sku: "LAMP", name: "Lamp", locationCode: "A-01-01", qty: 2, unitCostCents: 1500 },
    ]);
    const csv = valuationToCsv(rows, "2026-09-29");
    expect(csv).toContain("LAMP");
    expect(csv).toContain("30.00");
  });
});

describe("channel import", () => {
  it("groups etsy rows by order id", () => {
    const csv = `Order ID,Buyer,SKU,Quantity\n1001,Ada,LAMP,1\n1001,Ada,SHADE,1\n1002,Jo,BASE,3\n`;
    const parsed = parseChannelCsv("etsy", csv);
    expect(parsed.errors).toEqual([]);
    const groups = groupChannelRows(parsed.rows);
    expect(groups.get("1001")).toHaveLength(2);
  });
});

describe("recall", () => {
  it("summarizes hits", () => {
    const summary = buildRecallSummary([
      { kind: "balance", sku: "LAMP", qty: 3, locationCode: "A-01", detail: "on hand" },
      { kind: "as_built_parent", sku: "LAMP", detail: "built" },
    ]);
    expect(summary.balanceQty).toBe(3);
    expect(summary.asBuiltLinks).toBe(1);
  });
});
