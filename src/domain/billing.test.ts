import { describe, expect, it } from "vitest";
import { invoiceMailText, rateActivity } from "./billing";

const classic = { storage: 2, pick: 25, carton: 150 };

describe("rateActivity", () => {
  it("bills stored rates and keeps a document reference", () => {
    expect(
      rateActivity(
        [
          { kind: "storage", qty: 10 },
          { kind: "pick", qty: 4, refType: "order", refId: "ord-1", refNumber: "ORD-1" },
          { kind: "carton", qty: 2, refType: "order", refId: "ord-1", refNumber: "ORD-1" },
          { kind: "kit", qty: 3, refType: "kit", refId: "kit-1", refNumber: "KIT-1" },
        ],
        { ...classic, kit: 75 },
      ),
    ).toEqual({
      lines: [
        { kind: "storage", label: "On-hand pieces", qty: 10, unitCents: 2, amountCents: 20 },
        {
          kind: "pick",
          label: "Picked units",
          qty: 4,
          unitCents: 25,
          amountCents: 100,
          refType: "order",
          refId: "ord-1",
          refNumber: "ORD-1",
        },
        {
          kind: "carton",
          label: "Shipped cartons",
          qty: 2,
          unitCents: 150,
          amountCents: 300,
          refType: "order",
          refId: "ord-1",
          refNumber: "ORD-1",
        },
        {
          kind: "kit",
          label: "Kits completed",
          qty: 3,
          unitCents: 75,
          amountCents: 225,
          refType: "kit",
          refId: "kit-1",
          refNumber: "KIT-1",
        },
      ],
      amountCents: 645,
    });
  });

  it("skips an activity that has no stored rate", () => {
    expect(rateActivity([{ kind: "storage", qty: 10 }, { kind: "pick", qty: 4 }], { storage: 2 })).toEqual({
      lines: [{ kind: "storage", label: "On-hand pieces", qty: 10, unitCents: 2, amountCents: 20 }],
      amountCents: 20,
    });
  });

  it("keeps a zero rate as a line and drops an invoice that totals zero", () => {
    expect(
      rateActivity(
        [
          { kind: "storage", qty: 10 },
          { kind: "pick", qty: 4 },
        ],
        { storage: 2, pick: 0 },
      )?.lines.map((line) => line.amountCents),
    ).toEqual([20, 0]);
    expect(rateActivity([{ kind: "pick", qty: 4 }], { pick: 0 })).toBeNull();
    expect(rateActivity([{ kind: "storage", qty: 0 }], { storage: 2 })).toBeNull();
  });
});

describe("invoiceMailText", () => {
  it("names the invoice, the document, and the total", () => {
    const mail = invoiceMailText({
      number: "INV-1",
      clientName: "Acme Retail",
      lines: [{ kind: "pick", label: "Picked units", qty: 2, unitCents: 25, amountCents: 50, refNumber: "ORD-1" }],
      amountCents: 50,
    });
    expect(mail.subject).toBe("Invoice INV-1");
    expect(mail.text).toContain("Picked units (ORD-1) × 2 @ 0.25 = 0.50 USD");
    expect(mail.text).toContain("Total 0.50 USD");
  });
});
