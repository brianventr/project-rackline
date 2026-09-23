import { describe, expect, it } from "vitest";
import { ORDER_STEPS, RECEIPT_STEPS } from "./status";
import { STEP_RULES, stepStamps } from "./step-stamps";

const picks = [
  { type: "pick", createdAt: 300, createdByName: "Jordan" },
  { type: "pick", createdAt: 100, createdByName: "Maya" },
  { type: "ship", createdAt: 500, createdByName: "Jordan" },
];

describe("stepStamps", () => {
  it("stamps the first pick as picking and the last as picked", () => {
    const stamps = stepStamps(ORDER_STEPS, "shipped", picks, STEP_RULES.order);
    expect(stamps.picking).toEqual({ at: 100, by: "Maya" });
    expect(stamps.picked).toEqual({ at: 300, by: "Jordan" });
    expect(stamps.shipped).toEqual({ at: 500, by: "Jordan" });
  });

  it("leaves steps the document has not reached blank", () => {
    const stamps = stepStamps(ORDER_STEPS, "picking", picks, STEP_RULES.order);
    expect(stamps.picking).toBeDefined();
    expect(stamps.picked).toBeUndefined();
    expect(stamps.shipped).toBeUndefined();
  });

  it("returns nothing for a status outside the steps", () => {
    expect(stepStamps(RECEIPT_STEPS, "cancelled", picks, STEP_RULES.receipt)).toEqual({});
  });

  it("keeps a missing name as null", () => {
    const stamps = stepStamps(RECEIPT_STEPS, "received", [{ type: "receive", createdAt: 9 }], STEP_RULES.receipt);
    expect(stamps.received).toEqual({ at: 9, by: null });
  });
});
