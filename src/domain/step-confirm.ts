export class StepConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepConfirmError";
  }
}

export type RecipeStep = {
  id: string;
  seq: number;
  title: string;
  body: string;
  componentItemId: string | null;
  imageUrl?: string | null;
};

export type StepConfirmationQty = {
  stepId: string;
  qty: number;
};

export type StepComponentCodes = {
  itemId: string;
  sku: string;
  barcode: string;
  packs: { barcode: string | null; qty: number }[];
};

export type StepGap = {
  step: RecipeStep;
  confirmed: number;
  needed: number;
};

/** The name a refusal uses: "step 2, Seat the shade". A photo is not part of the name. */
export function stepName(step: Pick<RecipeStep, "seq" | "title" | "body">): string {
  const label = step.title.trim() || step.body.trim();
  return label ? `step ${step.seq}, ${label}` : `step ${step.seq}`;
}

export function stepsRequiredMessage(step: Pick<RecipeStep, "seq" | "title" | "body">): string {
  const label = step.title.trim() || step.body.trim();
  if (!label) return `Confirm step ${step.seq} before completing.`;
  return `Confirm step ${step.seq}, ${label}, before completing.`;
}

export function confirmedQty(confirmations: StepConfirmationQty[], stepId: string): number {
  return confirmations.reduce((sum, row) => (row.stepId === stepId ? sum + row.qty : sum), 0);
}

/**
 * The next recipe step that is short of `qtyCompleted + postedQty`.
 * No steps, or a post of nothing, has nothing to confirm. A photo is not a confirmation.
 */
export function nextUnconfirmedStep(input: {
  steps: RecipeStep[];
  confirmations: StepConfirmationQty[];
  qtyCompleted: number;
  postedQty: number;
}): StepGap | null {
  if (input.postedQty <= 0 || input.steps.length === 0) return null;
  const needed = input.qtyCompleted + input.postedQty;
  const ordered = [...input.steps].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
  for (const step of ordered) {
    const confirmed = confirmedQty(input.confirmations, step.id);
    if (confirmed < needed) return { step, confirmed, needed };
  }
  return null;
}

export function stepsCovered(input: {
  steps: RecipeStep[];
  confirmations: StepConfirmationQty[];
  qtyCompleted: number;
  postedQty: number;
}): boolean {
  return nextUnconfirmedStep(input) == null;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Units a component scan confirms. SKU and item barcode count 1. A pack barcode counts the pack. */
export function matchComponentScan(
  component: StepComponentCodes,
  code: string,
): { qty: number } | null {
  const value = normalizeCode(code);
  if (!value) return null;
  if (value === component.sku.trim().toUpperCase() || value === component.barcode.trim().toUpperCase()) {
    return { qty: 1 };
  }
  const pack = component.packs.find((row) => row.barcode && normalizeCode(row.barcode) === value);
  if (!pack || pack.qty <= 0) return null;
  return { qty: pack.qty };
}

/**
 * The confirmation to store. A component step needs a scan of that part. A step with no part is
 * confirmed by qty alone. One row may cover the whole posted qty.
 */
export function planStepConfirmation(input: {
  steps: RecipeStep[];
  confirmations: StepConfirmationQty[];
  documentQty: number;
  stepId?: string | null;
  code?: string | null;
  requestedQty?: number | null;
  components: StepComponentCodes[];
}): { stepId: string; qty: number; code: string | null } {
  if (!Number.isInteger(input.documentQty) || input.documentQty <= 0) {
    throw new StepConfirmError("Nothing to confirm");
  }
  const step = resolveStep(input);
  const component = step.componentItemId
    ? input.components.find((row) => row.itemId === step.componentItemId) ?? null
    : null;
  if (step.componentItemId && !component) throw new StepConfirmError("That component is not on the recipe");

  let scanQty: number | null = null;
  let code: string | null = null;
  if (step.componentItemId) {
    const raw = input.code?.trim() ?? "";
    if (!raw) throw new StepConfirmError(`Scan ${component?.sku ?? "the component"} to confirm ${stepName(step)}`);
    const match = component ? matchComponentScan(component, raw) : null;
    if (!match) throw new StepConfirmError(`Scan ${component?.sku ?? "the component"} to confirm ${stepName(step)}`);
    scanQty = match.qty;
    code = normalizeCode(raw);
  }

  const qty = input.requestedQty == null ? (scanQty ?? 1) : input.requestedQty;
  if (!Number.isInteger(qty) || qty <= 0) throw new StepConfirmError("Quantity must be a positive integer");
  const already = confirmedQty(input.confirmations, step.id);
  const room = input.documentQty - already;
  if (room <= 0) throw new StepConfirmError(`${stepName(step)} is already confirmed for the full quantity`);
  if (qty > room) throw new StepConfirmError(`Only ${room} left to confirm on ${stepName(step)}`);
  return { stepId: step.id, qty, code };
}

function resolveStep(input: {
  steps: RecipeStep[];
  confirmations: StepConfirmationQty[];
  documentQty: number;
  stepId?: string | null;
  code?: string | null;
  components: StepComponentCodes[];
}): RecipeStep {
  const wanted = input.stepId?.trim() || null;
  if (wanted) {
    const step = input.steps.find((row) => row.id === wanted);
    if (!step) throw new StepConfirmError("Step is not on this recipe");
    return step;
  }
  const code = input.code?.trim() ?? "";
  if (!code) throw new StepConfirmError("Choose a step to confirm");
  const ordered = [...input.steps].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
  for (const step of ordered) {
    if (!step.componentItemId) continue;
    if (confirmedQty(input.confirmations, step.id) >= input.documentQty) continue;
    const component = input.components.find((row) => row.itemId === step.componentItemId);
    if (component && matchComponentScan(component, code)) return step;
  }
  throw new StepConfirmError("That scan does not confirm a step");
}
