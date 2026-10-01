import { Hono, type Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, forbidden, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { planCompleteWorkOrder } from "../domain/manufacturing";
import { balanceKey } from "../domain/inventory";
import { isGarageMode } from "../domain/operating-mode";
import {
  assertBomGraph,
  BomCycleError,
  BomDepthError,
  madeComponentShortfalls,
  type BomGraphNode,
} from "../domain/nested-bom";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { canCompleteWorkOrder } from "../domain/status";
import { loadAsBuiltForRef } from "../db/as-built";
import { applyPartialComplete, isFullyCompleted, remainingToComplete, OverCompleteError } from "../domain/partial-complete";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";
import { loadBomRecipe, loadBomSteps } from "../db/bom-recipe";
import { BomStepError, normalizeBomSteps } from "../domain/bom-steps";
import { loadStepConfirmations, recordStepConfirmation } from "../db/step-confirm";
import { StepConfirmError, nextUnconfirmedStep, stepsRequiredMessage } from "../domain/step-confirm";
import { mediaStepKey } from "../domain/media";
import { deleteManagedMedia, putMediaFile, readUploadedFile } from "../lib/media-store";

export const manufacturingRoute = new Hono<AppEnv>();

async function assertManufacturer(c: Context<AppEnv>) {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  if (isGarageMode(org?.operatingMode)) forbidden("Work centers are a Manufacturer tool");
  return { db, organizationId };
}

async function loadBomGraph(db: AppEnv["Variables"]["db"], organizationId: string): Promise<BomGraphNode[]> {
  const headers = await db
    .select({ id: schema.boms.id, itemId: schema.boms.itemId })
    .from(schema.boms)
    .where(eq(schema.boms.organizationId, organizationId));
  if (headers.length === 0) return [];
  const lines = await db
    .select({ bomId: schema.bomLines.bomId, itemId: schema.bomLines.itemId, qty: schema.bomLines.qty })
    .from(schema.bomLines)
    .where(
      inArray(
        schema.bomLines.bomId,
        headers.map((row) => row.id),
      ),
    );
  return headers.map((header) => ({
    itemId: header.itemId,
    lines: lines.filter((line) => line.bomId === header.id).map((line) => ({ itemId: line.itemId, qty: line.qty })),
  }));
}

function refuseBomGraph(boms: BomGraphNode[]) {
  try {
    assertBomGraph(boms);
  } catch (err) {
    if (err instanceof BomCycleError || err instanceof BomDepthError) badRequest(err.message);
    throw err;
  }
}

async function onHandAt(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  locationId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const loaded = await loadBalanceMap(
    db,
    organizationId,
    itemIds.map((itemId) => ({ locationId, itemId })),
  );
  const qty = qtyMap(loaded);
  for (const itemId of itemIds) out.set(itemId, qty.get(balanceKey(locationId, itemId)) ?? 0);
  return out;
}

async function childWorkOrders(db: AppEnv["Variables"]["db"], organizationId: string, parentId: string) {
  return db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      status: schema.workOrders.status,
      qty: schema.workOrders.qty,
    })
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.organizationId, organizationId), eq(schema.workOrders.parentWorkOrderId, parentId)));
}

/** Direct made components that are short. Names an existing child work order when one is linked. */
async function refuseShortMadeComponents(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  wo: { id: string; sourceLocationId: string; components?: { itemId: string; sku: string; qty: number }[] },
  produceQty: number,
) {
  const lines = wo.components ?? [];
  const graph = await loadBomGraph(db, organizationId);
  const shorts = madeComponentShortfalls({
    lines,
    madeItemIds: new Set(graph.map((node) => node.itemId)),
    produceQty,
    onHandByItem: await onHandAt(
      db,
      organizationId,
      wo.sourceLocationId,
      lines.map((line) => line.itemId),
    ),
  });
  if (shorts.length === 0) return;
  const children = await childWorkOrders(db, organizationId, wo.id);
  const sentences = shorts.map((short) => {
    const child =
      children.find((row) => row.itemId === short.itemId && (row.status === "draft" || row.status === "in_progress")) ??
      children.find((row) => row.itemId === short.itemId);
    const name = child ? child.number : "a child work order";
    return `${short.sku} is short (${short.onHand} on hand, need ${short.needed}). Finish ${name} before this work order can complete.`;
  });
  conflict(sentences.join(" "), "COMPONENT_SHORT");
}

async function bomWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [bom] = await db
    .select({
      id: schema.boms.id,
      itemId: schema.boms.itemId,
      createdAt: schema.boms.createdAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
    })
    .from(schema.boms)
    .innerJoin(schema.items, eq(schema.items.id, schema.boms.itemId))
    .where(and(eq(schema.boms.id, id), eq(schema.boms.organizationId, organizationId)))
    .limit(1);
  if (!bom) notFound("BOM not found");
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
    .where(eq(schema.bomLines.bomId, id));
  const steps = await loadBomSteps(db, id);
  return { ...bom, lines, steps };
}

manufacturingRoute.get("/boms", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const headers = await db
    .select({
      id: schema.boms.id,
      itemId: schema.boms.itemId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      createdAt: schema.boms.createdAt,
    })
    .from(schema.boms)
    .innerJoin(schema.items, eq(schema.items.id, schema.boms.itemId))
    .where(eq(schema.boms.organizationId, organizationId));

  const result = [];
  for (const bom of headers) {
    result.push(await bomWithLines(db, organizationId, bom.id));
  }
  return c.json(result);
});

manufacturingRoute.post("/boms", async (c) => {
  const body = await c.req.json<{
    itemId?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const itemId = requireString(body.itemId, "itemId");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("BOM needs at least one component");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const parent = await getOrgItem(db, organizationId, itemId);
  if (parent.type !== "finished" && parent.type !== "wip") {
    badRequest("BOM parent must be a finished or WIP item");
  }

  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const componentId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Component quantity must be positive");
    if (componentId === itemId) badRequest("An item cannot be a component of itself");
    await getOrgItem(db, organizationId, componentId);
    lines.push({ id: newId(), bomId: id, itemId: componentId, qty });
  }

  const graph = await loadBomGraph(db, organizationId);
  refuseBomGraph([
    ...graph.filter((node) => node.itemId !== itemId),
    { itemId, lines: lines.map((line) => ({ itemId: line.itemId, qty: line.qty })) },
  ]);

  try {
    await db.batch([
      db.insert(schema.boms).values({
        id,
        organizationId,
        itemId,
        createdAt: Date.now(),
      }),
      ...lines.map((line) => db.insert(schema.bomLines).values(line)),
    ]);
  } catch {
    return c.json({ error: "A BOM already exists for this item" }, 409);
  }

  return c.json(await bomWithLines(db, organizationId, id), 201);
});

manufacturingRoute.put("/boms/:id/steps", async (c) => {
  const body = await c.req.json<{ steps?: unknown }>();
  if (!Array.isArray(body.steps)) badRequest("steps is required");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const bom = await bomWithLines(db, organizationId, c.req.param("id"));
  const centers = await db
    .select({ id: schema.workCenters.id })
    .from(schema.workCenters)
    .where(eq(schema.workCenters.organizationId, organizationId));
  let normalized;
  try {
    normalized = normalizeBomSteps(
      body.steps,
      bom.lines.map((line) => line.itemId),
      centers.map((center) => center.id),
    );
  } catch (err) {
    if (err instanceof BomStepError) badRequest(err.message);
    throw err;
  }
  const existingIds = new Set(bom.steps.map((step) => step.id));
  const next = normalized.map((step) => ({
    id: step.id && existingIds.has(step.id) ? step.id : newId(),
    bomId: bom.id,
    seq: step.seq,
    title: step.title,
    body: step.body,
    imageUrl: step.imageUrl,
    componentItemId: step.componentItemId,
    workCenterId: step.workCenterId,
  }));
  const keepIds = new Set(next.map((step) => step.id));
  for (const step of bom.steps) {
    if (!keepIds.has(step.id)) await deleteManagedMedia(c.env.MEDIA, step.imageUrl);
  }
  await db.delete(schema.bomSteps).where(eq(schema.bomSteps.bomId, bom.id));
  if (next.length) {
    await db.insert(schema.bomSteps).values(next);
  }
  return c.json(await bomWithLines(db, organizationId, bom.id));
});

manufacturingRoute.post("/boms/:id/steps/:stepId/image", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const bom = await bomWithLines(db, organizationId, c.req.param("id"));
  const step = bom.steps.find((row) => row.id === c.req.param("stepId"));
  if (!step) notFound("Step not found");
  const file = await readUploadedFile(c.req.raw);
  const key = mediaStepKey(organizationId, bom.id, step.id);
  const imageUrl = await putMediaFile(c.env.MEDIA, key, file);
  if (step.imageUrl && step.imageUrl !== imageUrl) {
    await deleteManagedMedia(c.env.MEDIA, step.imageUrl);
  }
  await db.update(schema.bomSteps).set({ imageUrl }).where(eq(schema.bomSteps.id, step.id));
  return c.json(await bomWithLines(db, organizationId, bom.id));
});

manufacturingRoute.delete("/boms/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const bom = await bomWithLines(db, organizationId, c.req.param("id"));
  for (const step of bom.steps) await deleteManagedMedia(c.env.MEDIA, step.imageUrl);
  await db
    .delete(schema.boms)
    .where(and(eq(schema.boms.id, c.req.param("id")), eq(schema.boms.organizationId, organizationId)));
  return c.json({ ok: true });
});

async function workOrderWithItem(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
      status: schema.workOrders.status,
      warehouseId: schema.workOrders.warehouseId,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      createdAt: schema.workOrders.createdAt,
      completedAt: schema.workOrders.completedAt,
      parentWorkOrderId: schema.workOrders.parentWorkOrderId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Work order not found");
  const asBuilt = await loadAsBuiltForRef(db, organizationId, row.id);
  const recipe = await loadBomRecipe(db, organizationId, row.itemId);
  const confirmations = await loadStepConfirmations(db, organizationId, "work_order", row.id);
  const children = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
      status: schema.workOrders.status,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(and(eq(schema.workOrders.organizationId, organizationId), eq(schema.workOrders.parentWorkOrderId, row.id)))
    .orderBy(desc(schema.workOrders.createdAt));
  let parentNumber: string | null = null;
  if (row.parentWorkOrderId) {
    const [parent] = await db
      .select({ number: schema.workOrders.number })
      .from(schema.workOrders)
      .where(and(eq(schema.workOrders.id, row.parentWorkOrderId), eq(schema.workOrders.organizationId, organizationId)))
      .limit(1);
    parentNumber = parent?.number ?? null;
  }
  return {
    ...row,
    parentNumber,
    children,
    remaining: remainingToComplete(row.qty, row.qtyCompleted),
    asBuilt,
    components: recipe.lines,
    steps: recipe.steps,
    confirmations,
  };
}

manufacturingRoute.get("/work-centers", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.workCenters.id,
      code: schema.workCenters.code,
      name: schema.workCenters.name,
    })
    .from(schema.workCenters)
    .where(eq(schema.workCenters.organizationId, organizationId))
    .orderBy(schema.workCenters.code);
  return c.json(rows);
});

manufacturingRoute.post("/work-centers", async (c) => {
  requireOwner(c.get("role"));
  const { db, organizationId } = await assertManufacturer(c);
  const body = await c.req.json<{ code?: string; name?: string }>();
  const code = requireString(body.code, "code").trim();
  const name = requireString(body.name, "name").trim();
  if (!code || !name) badRequest("Code and name are required");
  const id = newId();
  try {
    await db.insert(schema.workCenters).values({ id, organizationId, code, name });
  } catch {
    conflict("A work center with this code already exists");
  }
  return c.json({ id, code, name }, 201);
});

manufacturingRoute.patch("/work-centers/:id", async (c) => {
  requireOwner(c.get("role"));
  const { db, organizationId } = await assertManufacturer(c);
  const body = await c.req.json<{ code?: string; name?: string }>();
  const [current] = await db
    .select()
    .from(schema.workCenters)
    .where(and(eq(schema.workCenters.id, c.req.param("id")), eq(schema.workCenters.organizationId, organizationId)))
    .limit(1);
  if (!current) notFound("Work center not found");
  const code = body.code === undefined ? current.code : requireString(body.code, "code").trim();
  const name = body.name === undefined ? current.name : requireString(body.name, "name").trim();
  if (!code || !name) badRequest("Code and name are required");
  try {
    await db
      .update(schema.workCenters)
      .set({ code, name })
      .where(eq(schema.workCenters.id, current.id));
  } catch {
    conflict("A work center with this code already exists");
  }
  return c.json({ id: current.id, code, name });
});

manufacturingRoute.delete("/work-centers/:id", async (c) => {
  requireOwner(c.get("role"));
  const { db, organizationId } = await assertManufacturer(c);
  const [current] = await db
    .select({ id: schema.workCenters.id })
    .from(schema.workCenters)
    .where(and(eq(schema.workCenters.id, c.req.param("id")), eq(schema.workCenters.organizationId, organizationId)))
    .limit(1);
  if (!current) notFound("Work center not found");
  await db.delete(schema.workCenters).where(eq(schema.workCenters.id, current.id));
  return c.json({ ok: true });
});

manufacturingRoute.get("/work-orders", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
      status: schema.workOrders.status,
      warehouseId: schema.workOrders.warehouseId,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      createdAt: schema.workOrders.createdAt,
      completedAt: schema.workOrders.completedAt,
      parentWorkOrderId: schema.workOrders.parentWorkOrderId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(eq(schema.workOrders.organizationId, organizationId))
    .orderBy(desc(schema.workOrders.createdAt));
  return c.json(rows.map((row) => ({ ...row, remaining: remainingToComplete(row.qty, row.qtyCompleted) })));
});

manufacturingRoute.get("/work-orders/:id", async (c) => {
  return c.json(await workOrderWithItem(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

manufacturingRoute.post("/work-orders", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    itemId?: string;
    qty?: number;
    sourceLocationId?: string;
    outputLocationId?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const itemId = requireString(body.itemId, "itemId");
  const qty = requireInt(body.qty, "qty");
  const sourceLocationId = requireString(body.sourceLocationId, "sourceLocationId");
  const outputLocationId = requireString(body.outputLocationId, "outputLocationId");
  if (qty <= 0) badRequest("Quantity must be positive");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgItem(db, organizationId, itemId);
  await getOrgLocation(db, organizationId, sourceLocationId);
  await getOrgLocation(db, organizationId, outputLocationId);

  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, itemId)))
    .limit(1);
  if (!bom) badRequest("Create a BOM for this item before releasing a work order");

  const [row] = await db
    .insert(schema.workOrders)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("WO"),
      itemId,
      qty,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId,
      outputLocationId,
      createdAt: Date.now(),
    })
    .returning();

  const created = await workOrderWithItem(db, organizationId, row.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "workOrder",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: `${created.sku} × ${created.qty}`,
    fromLocationId: created.sourceLocationId,
    toLocationId: created.outputLocationId,
    itemId: created.itemId,
    qty: created.qty,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

manufacturingRoute.post("/work-orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (wo.status !== "draft") conflict("Work order is not a draft");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: wo.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "workOrder",
    refId: wo.id,
    verb: "assemble",
    number: wo.number,
    title: `${wo.sku} × ${wo.qty}`,
    fromLocationId: wo.sourceLocationId,
    toLocationId: wo.outputLocationId,
    itemId: wo.itemId,
    qty: wo.qty,
    createdAt: wo.createdAt,
  });
  await db.update(schema.workOrders).set({ status: "in_progress" }).where(eq(schema.workOrders.id, wo.id));
  const started = await workOrderWithItem(db, organizationId, wo.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "workOrder",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: `${started.sku} × ${started.qty}`,
    fromLocationId: started.sourceLocationId,
    toLocationId: started.outputLocationId,
    itemId: started.itemId,
    qty: started.qty - (started.qtyCompleted ?? 0),
    createdAt: started.createdAt,
  });
  return c.json(started);
});

manufacturingRoute.post("/work-orders/:id/steps/confirm", async (c) => {
  const body = await c.req.json<{ stepId?: string; code?: string; qty?: number }>().catch(() => ({}) as {
    stepId?: string;
    code?: string;
    qty?: number;
  });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteWorkOrder(wo.status)) conflict("Work order already completed");
  let requestedQty: number | null = null;
  if (body.qty !== undefined && body.qty !== null) requestedQty = requireInt(body.qty, "qty");
  try {
    await recordStepConfirmation(db, {
      organizationId,
      refType: "work_order",
      refId: wo.id,
      documentQty: wo.qty,
      steps: wo.steps,
      confirmedBy: c.get("user")?.id ?? null,
      stepId: body.stepId,
      code: body.code,
      requestedQty,
      now: Date.now(),
    });
  } catch (err) {
    if (err instanceof StepConfirmError) badRequest(err.message);
    throw err;
  }
  return c.json(await workOrderWithItem(db, organizationId, wo.id));
});

manufacturingRoute.post("/work-orders/:id/build-short", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteWorkOrder(wo.status)) conflict("Work order already completed");
  const remaining = remainingToComplete(wo.qty, wo.qtyCompleted);
  if (remaining <= 0) conflict("Work order has nothing remaining");

  const lines = wo.components ?? [];
  const graph = await loadBomGraph(db, organizationId);
  const shorts = madeComponentShortfalls({
    lines,
    madeItemIds: new Set(graph.map((node) => node.itemId)),
    produceQty: remaining,
    onHandByItem: await onHandAt(
      db,
      organizationId,
      wo.sourceLocationId,
      lines.map((line) => line.itemId),
    ),
  });
  const open = (await childWorkOrders(db, organizationId, wo.id)).filter(
    (row) => row.status === "draft" || row.status === "in_progress",
  );
  const created: { id: string; number: string; itemId: string; sku: string; qty: number }[] = [];
  const existing: { id: string; number: string; itemId: string; sku: string; qty: number }[] = [];
  const now = Date.now();
  for (const short of shorts) {
    const already = open.find((row) => row.itemId === short.itemId);
    if (already) {
      existing.push({ id: already.id, number: already.number, itemId: short.itemId, sku: short.sku, qty: already.qty });
      continue;
    }
    const id = newId();
    const number = docNumber("WO");
    await db.insert(schema.workOrders).values({
      id,
      organizationId,
      warehouseId: wo.warehouseId,
      number,
      itemId: short.itemId,
      qty: short.shortQty,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId: wo.sourceLocationId,
      outputLocationId: wo.sourceLocationId,
      createdAt: now,
      parentWorkOrderId: wo.id,
    });
    await syncDocumentJob(db, {
      organizationId,
      warehouseId: wo.warehouseId,
      refType: "workOrder",
      refId: id,
      status: "draft",
      number,
      title: `${short.sku} × ${short.shortQty}`,
      fromLocationId: wo.sourceLocationId,
      toLocationId: wo.sourceLocationId,
      itemId: short.itemId,
      qty: short.shortQty,
      createdAt: now,
    });
    created.push({ id, number, itemId: short.itemId, sku: short.sku, qty: short.shortQty });
  }
  return c.json({ created, existing });
});

manufacturingRoute.post("/work-orders/:id/complete", async (c) => {
  const body = await c.req
    .json<{ qty?: number }>()
    .catch(() => ({}) as { qty?: number });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteWorkOrder(wo.status)) conflict("Work order already completed");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: wo.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "workOrder",
    refId: wo.id,
    verb: "assemble",
    number: wo.number,
    title: `${wo.sku} × ${wo.qty}`,
    fromLocationId: wo.sourceLocationId,
    toLocationId: wo.outputLocationId,
    itemId: wo.itemId,
    createdAt: wo.createdAt,
  });

  const remaining = remainingToComplete(wo.qty, wo.qtyCompleted);
  if (remaining <= 0) conflict("Work order has nothing remaining");
  let thisQty = remaining;
  if (body.qty !== undefined && body.qty !== null) {
    thisQty = requireInt(body.qty, "qty");
  }
  let applied;
  try {
    applied = applyPartialComplete({ sku: wo.sku, qty: wo.qty, qtyCompleted: wo.qtyCompleted }, thisQty);
  } catch (err) {
    if (err instanceof OverCompleteError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid complete qty");
  }

  const gap = nextUnconfirmedStep({
    steps: wo.steps,
    confirmations: wo.confirmations,
    qtyCompleted: wo.qtyCompleted,
    postedQty: applied.postedQty,
  });
  if (gap) conflict(stepsRequiredMessage(gap.step), "STEPS_REQUIRED");

  await refuseShortMadeComponents(db, organizationId, wo, applied.postedQty);

  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, wo.itemId)))
    .limit(1);
  if (!bom) badRequest("BOM is missing");

  const components = await db
    .select({
      itemId: schema.bomLines.itemId,
      qty: schema.bomLines.qty,
      sku: schema.items.sku,
    })
    .from(schema.bomLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.bomLines.itemId))
    .where(eq(schema.bomLines.bomId, bom.id));

  const pairs = [
    ...components.map((line) => ({ locationId: wo.sourceLocationId, itemId: line.itemId })),
    { locationId: wo.outputLocationId, itemId: wo.itemId },
  ];
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const plan = planCompleteWorkOrder({
    workOrderId: wo.id,
    finishedItemId: wo.itemId,
    finishedSku: wo.sku,
    qty: applied.postedQty,
    sourceLocationId: wo.sourceLocationId,
    outputLocationId: wo.outputLocationId,
    bomLines: components,
    balances: qtyMap(loaded),
  });

  const now = Date.now();
  const nextStatus = isFullyCompleted(wo.qty, applied.qtyCompleted) ? "completed" : "in_progress";
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.workOrders)
        .set({
          status: nextStatus,
          qtyCompleted: applied.qtyCompleted,
          completedAt: nextStatus === "completed" ? now : wo.completedAt,
        })
        .where(eq(schema.workOrders.id, wo.id)),
    ],
  });

  const completed = await workOrderWithItem(db, organizationId, wo.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: completed.warehouseId,
    refType: "workOrder",
    refId: completed.id,
    status: completed.status,
    number: completed.number,
    title: `${completed.sku} × ${completed.qty}`,
    fromLocationId: completed.sourceLocationId,
    toLocationId: completed.outputLocationId,
    itemId: completed.itemId,
    qty: completed.qty - (completed.qtyCompleted ?? 0),
    createdAt: completed.createdAt,
  });
  return c.json(completed);
});
