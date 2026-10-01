import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { loadPacksForItem } from "./item-packs";
import {
  planStepConfirmation,
  type RecipeStep,
  type StepComponentCodes,
  type StepConfirmationQty,
} from "../domain/step-confirm";

export async function loadStepConfirmations(
  db: AppDb,
  organizationId: string,
  refType: "kit" | "work_order",
  refId: string,
): Promise<StepConfirmationQty[]> {
  const rows = await db
    .select({
      stepId: schema.stepConfirmations.stepId,
      qty: schema.stepConfirmations.qty,
    })
    .from(schema.stepConfirmations)
    .where(
      and(
        eq(schema.stepConfirmations.organizationId, organizationId),
        eq(schema.stepConfirmations.refType, refType),
        eq(schema.stepConfirmations.refId, refId),
      ),
    );
  const byStep = new Map<string, number>();
  for (const row of rows) byStep.set(row.stepId, (byStep.get(row.stepId) ?? 0) + row.qty);
  return [...byStep].map(([stepId, qty]) => ({ stepId, qty }));
}

export async function recordStepConfirmation(
  db: AppDb,
  input: {
    organizationId: string;
    refType: "kit" | "work_order";
    refId: string;
    documentQty: number;
    steps: RecipeStep[];
    confirmedBy: string | null;
    stepId?: string | null;
    code?: string | null;
    requestedQty?: number | null;
    now: number;
  },
): Promise<{ stepId: string; qty: number }> {
  const confirmations = await loadStepConfirmations(db, input.organizationId, input.refType, input.refId);
  const components = await loadStepComponents(db, input.organizationId, input.steps);
  const planned = planStepConfirmation({
    steps: input.steps,
    confirmations,
    documentQty: input.documentQty,
    stepId: input.stepId,
    code: input.code,
    requestedQty: input.requestedQty,
    components,
  });
  await db.insert(schema.stepConfirmations).values({
    id: newId(),
    organizationId: input.organizationId,
    refType: input.refType,
    refId: input.refId,
    stepId: planned.stepId,
    qty: planned.qty,
    code: planned.code,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.now,
  });
  return { stepId: planned.stepId, qty: planned.qty };
}

async function loadStepComponents(
  db: AppDb,
  organizationId: string,
  steps: RecipeStep[],
): Promise<StepComponentCodes[]> {
  const ids = [...new Set(steps.map((step) => step.componentItemId).filter((id): id is string => Boolean(id)))];
  const components: StepComponentCodes[] = [];
  for (const itemId of ids) {
    const [item] = await db
      .select({
        id: schema.items.id,
        sku: schema.items.sku,
        barcode: schema.items.barcode,
      })
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.id, itemId)))
      .limit(1);
    if (!item) continue;
    const packs = await loadPacksForItem(db, organizationId, item.id);
    components.push({
      itemId: item.id,
      sku: item.sku,
      barcode: item.barcode,
      packs: packs.map((pack) => ({ barcode: pack.barcode, qty: pack.qty })),
    });
  }
  return components;
}
