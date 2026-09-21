import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";

export type BomComponentView = {
  id: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
  imageUrl: string | null;
};

export type BomStepView = {
  id: string;
  seq: number;
  title: string;
  body: string;
  imageUrl: string | null;
  componentItemId: string | null;
  componentSku: string | null;
  componentName: string | null;
  componentImageUrl: string | null;
};

export async function loadBomSteps(db: AppDb, bomId: string): Promise<BomStepView[]> {
  return db
    .select({
      id: schema.bomSteps.id,
      seq: schema.bomSteps.seq,
      title: schema.bomSteps.title,
      body: schema.bomSteps.body,
      imageUrl: schema.bomSteps.imageUrl,
      componentItemId: schema.bomSteps.componentItemId,
      componentSku: schema.items.sku,
      componentName: schema.items.name,
      componentImageUrl: schema.items.imageUrl,
    })
    .from(schema.bomSteps)
    .leftJoin(schema.items, eq(schema.items.id, schema.bomSteps.componentItemId))
    .where(eq(schema.bomSteps.bomId, bomId))
    .orderBy(schema.bomSteps.seq);
}

export async function loadBomRecipe(
  db: AppDb,
  organizationId: string,
  parentItemId: string,
): Promise<{
  bom: typeof schema.boms.$inferSelect | null;
  lines: BomComponentView[];
  steps: BomStepView[];
}> {
  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, parentItemId)))
    .limit(1);
  if (!bom) return { bom: null, lines: [], steps: [] };
  const lines = await db
    .select({
      id: schema.bomLines.id,
      itemId: schema.bomLines.itemId,
      qty: schema.bomLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
    })
    .from(schema.bomLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.bomLines.itemId))
    .where(eq(schema.bomLines.bomId, bom.id));
  const steps = await loadBomSteps(db, bom.id);
  return { bom, lines, steps };
}
