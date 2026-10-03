import { describe, expect, it } from "vitest";
import { quickbooksBill, quickbooksConfigured } from "./quickbooks";

describe("quickbooks bill", () => {
  it("builds an account-based bill and adds freight as its own line", () => {
    const bill = quickbooksBill({
      vendorName: "Harbor",
      docNumber: "PO-1",
      expenseAccountId: "80",
      txnDate: "2026-10-03",
      freightCents: 250,
      lines: [{ sku: "LED", name: "Bulb", qty: 2, unitCostCents: 100 }],
    });
    expect(bill.VendorRef.name).toBe("Harbor");
    expect(bill.Line.map((line) => line.Amount)).toEqual([2, 2.5]);
    expect(bill.Line[1]?.Description).toBe("Freight");
    expect(bill.Line[0]?.AccountBasedExpenseLineDetail.AccountRef.value).toBe("80");
  });

  it("is connected only when realm, token, and expense account are set", () => {
    expect(quickbooksConfigured({ realmId: "1", accessToken: "tok", expenseAccountId: "80" })).toBe(true);
    expect(quickbooksConfigured({ realmId: "1", accessToken: "", expenseAccountId: "80" })).toBe(false);
  });
});