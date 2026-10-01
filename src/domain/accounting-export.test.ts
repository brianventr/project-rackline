import { describe, expect, it } from "vitest";
import { invoicesToCsv } from "./accounting-export";

describe("invoicesToCsv", () => {
  it("writes one row per invoice line", () => {
    const csv = invoicesToCsv([
      {
        number: "INV-1",
        clientCode: "ACME",
        status: "draft",
        periodStart: Date.UTC(2026, 8, 1),
        periodEnd: Date.UTC(2026, 9, 1),
        amountCents: 125,
        lines: [
          { kind: "pick", label: "Picked units", qty: 5, unitCents: 25, amountCents: 125 },
        ],
      },
    ]);
    expect(csv).toContain("Invoice,Client,Status,Period Start,Period End,Line,Qty,Unit Amount,Amount,Account Hint");
    expect(csv).toContain("INV-1,ACME,draft,2026-09-01,2026-10-01,Picked units,5,0.25,1.25,3PL Income");
  });

  it("writes one row for an invoice that has no stored lines", () => {
    const csv = invoicesToCsv([
      {
        number: "INV-2",
        clientCode: null,
        status: "draft",
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 0, 31),
        amountCents: 150,
        lines: [],
      },
    ]);
    expect(csv).toContain("INV-2,,draft,2026-01-01,2026-01-31,Invoice,1,1.50,1.50,3PL Income");
  });
});
