/**
 * A received purchase as a QuickBooks bill. Account-based lines, because Rackline does not
 * keep a chart of accounts. The CSV exports stay the fallback when this is not connected.
 */

export type QuickbooksLine = {
  sku: string;
  name: string;
  qty: number;
  unitCostCents: number;
};

export type QuickbooksBillInput = {
  vendorName: string;
  docNumber: string;
  expenseAccountId: string;
  txnDate: string;
  lines: QuickbooksLine[];
  freightCents: number;
};

export function quickbooksBill(input: QuickbooksBillInput): {
  VendorRef: { name: string };
  DocNumber: string;
  TxnDate: string;
  Line: {
    Amount: number;
    DetailType: "AccountBasedExpenseLineDetail";
    Description: string;
    AccountBasedExpenseLineDetail: { AccountRef: { value: string } };
  }[];
} {
  const lines = input.lines
    .filter((line) => line.qty > 0)
    .map((line) => {
      const amount = (line.qty * Math.max(0, line.unitCostCents)) / 100;
      return {
        Amount: roundMoney(amount),
        DetailType: "AccountBasedExpenseLineDetail" as const,
        Description: `${line.sku} ${line.name} × ${line.qty}`,
        AccountBasedExpenseLineDetail: { AccountRef: { value: input.expenseAccountId } },
      };
    });
  if (input.freightCents > 0) {
    lines.push({
      Amount: roundMoney(input.freightCents / 100),
      DetailType: "AccountBasedExpenseLineDetail",
      Description: "Freight",
      AccountBasedExpenseLineDetail: { AccountRef: { value: input.expenseAccountId } },
    });
  }
  return {
    VendorRef: { name: input.vendorName },
    DocNumber: input.docNumber.slice(0, 21),
    TxnDate: input.txnDate,
    Line: lines,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function quickbooksConfigured(input: {
  realmId?: string | null;
  accessToken?: string | null;
  expenseAccountId?: string | null;
}): boolean {
  return Boolean(input.realmId?.trim() && input.accessToken?.trim() && input.expenseAccountId?.trim());
}
