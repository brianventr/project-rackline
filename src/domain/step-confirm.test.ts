import { describe, expect, it } from "vitest";
import {
  StepConfirmError,
  matchComponentScan,
  nextUnconfirmedStep,
  planStepConfirmation,
  stepsCovered,
  stepsRequiredMessage,
  type RecipeStep,
  type StepComponentCodes,
} from "./step-confirm";

const shade: RecipeStep = {
  id: "shade-step",
  seq: 2,
  title: "Seat the shade",
  body: "Press it on.",
  componentItemId: "shade",
  imageUrl: "/demo-sku/SHADE.svg",
};
const cord: RecipeStep = {
  id: "cord-step",
  seq: 1,
  title: "",
  body: "Thread the cord",
  componentItemId: null,
  imageUrl: "/demo-sku/CORD.svg",
};
const steps = [shade, cord];
const shadeCodes: StepComponentCodes = {
  itemId: "shade",
  sku: "SHADE",
  barcode: "SHADE-BC",
  packs: [{ barcode: "SHADE-CS", qty: 6 }],
};

describe("nextUnconfirmedStep", () => {
  it("lets a recipe with no steps complete", () => {
    expect(
      nextUnconfirmedStep({ steps: [], confirmations: [], qtyCompleted: 0, postedQty: 3 }),
    ).toBeNull();
    expect(stepsCovered({ steps: [], confirmations: [], qtyCompleted: 0, postedQty: 3 })).toBe(true);
  });

  it("does not apply when nothing is being posted", () => {
    expect(nextUnconfirmedStep({ steps, confirmations: [], qtyCompleted: 0, postedQty: 0 })).toBeNull();
  });

  it("names the earliest step that is short of the posted qty", () => {
    const gap = nextUnconfirmedStep({ steps, confirmations: [], qtyCompleted: 0, postedQty: 3 });
    expect(gap?.step.id).toBe("cord-step");
    expect(gap?.needed).toBe(3);
    expect(stepsRequiredMessage(gap!.step)).toBe("Confirm step 1, Thread the cord, before completing.");
  });

  it("counts one confirmation that covers the posted qty, or several that add up", () => {
    expect(
      nextUnconfirmedStep({
        steps,
        confirmations: [
          { stepId: "cord-step", qty: 3 },
          { stepId: "shade-step", qty: 3 },
        ],
        qtyCompleted: 0,
        postedQty: 3,
      }),
    ).toBeNull();
    expect(
      nextUnconfirmedStep({
        steps,
        confirmations: [
          { stepId: "cord-step", qty: 1 },
          { stepId: "cord-step", qty: 1 },
          { stepId: "cord-step", qty: 1 },
          { stepId: "shade-step", qty: 1 },
          { stepId: "shade-step", qty: 1 },
          { stepId: "shade-step", qty: 1 },
        ],
        qtyCompleted: 0,
        postedQty: 3,
      }),
    ).toBeNull();
  });

  it("keeps earlier confirmations and asks for the next units", () => {
    const gap = nextUnconfirmedStep({
      steps,
      confirmations: [
        { stepId: "cord-step", qty: 2 },
        { stepId: "shade-step", qty: 2 },
      ],
      qtyCompleted: 2,
      postedQty: 1,
    });
    expect(gap?.step.id).toBe("cord-step");
    expect(gap?.confirmed).toBe(2);
    expect(gap?.needed).toBe(3);
  });

  it("does not treat a photo as proof", () => {
    const gap = nextUnconfirmedStep({
      steps: [{ ...cord, imageUrl: "/demo-sku/CORD.svg" }],
      confirmations: [],
      qtyCompleted: 0,
      postedQty: 1,
    });
    expect(gap?.step.id).toBe("cord-step");
  });
});

describe("planStepConfirmation", () => {
  const base = {
    steps,
    confirmations: [] as { stepId: string; qty: number }[],
    documentQty: 4,
    components: [shadeCodes],
  };

  it("confirms a component by SKU, barcode, or pack barcode", () => {
    expect(matchComponentScan(shadeCodes, "shade")).toEqual({ qty: 1 });
    expect(matchComponentScan(shadeCodes, "SHADE-BC")).toEqual({ qty: 1 });
    expect(matchComponentScan(shadeCodes, "shade-cs")).toEqual({ qty: 6 });
    expect(matchComponentScan(shadeCodes, "/demo-sku/SHADE.svg")).toBeNull();
    expect(planStepConfirmation({ ...base, code: "SHADE" }).qty).toBe(1);
    expect(planStepConfirmation({ ...base, documentQty: 6, code: "SHADE-CS" })).toMatchObject({
      stepId: "shade-step",
      qty: 6,
    });
  });

  it("lets one explicit confirmation cover the posted qty", () => {
    expect(planStepConfirmation({ ...base, stepId: "cord-step", requestedQty: 3 })).toEqual({
      stepId: "cord-step",
      qty: 3,
      code: null,
    });
  });

  it("refuses a component step that was not scanned", () => {
    expect(() => planStepConfirmation({ ...base, stepId: "shade-step", requestedQty: 3 })).toThrow(StepConfirmError);
    expect(() => planStepConfirmation({ ...base, stepId: "shade-step", code: "CORD" })).toThrow(/Scan SHADE/);
  });

  it("stops at the build qty", () => {
    expect(() =>
      planStepConfirmation({
        ...base,
        confirmations: [{ stepId: "cord-step", qty: 4 }],
        stepId: "cord-step",
        requestedQty: 1,
      }),
    ).toThrow(/already confirmed/);
    expect(() => planStepConfirmation({ ...base, stepId: "cord-step", requestedQty: 5 })).toThrow(/Only 4 left/);
  });
});
