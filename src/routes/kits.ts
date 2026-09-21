import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, optionalClientId } from "../lib/org";
import { stampProducedClient } from "../domain/clients";
import { docNumber, newId } from "../lib/ids";
import { planCompleteKit } from "../domain/manufacturing";
import { planDekit } from "../domain/dekit";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { canCompleteKit, canDekit } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { loadAsBuiltForRef } from "../db/as-built";
import { applyPartialComplete, isFullyCompleted, remainingToComplete, OverCompleteError } from "../domain/partial-complete";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";

export const kitsRoute = new Hono<AppEnv>();

async function kitWithItem(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.kitBuilds.id,
      number: schema.kitBuilds.number,
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
      status: schema.kitBuilds.status,
      warehouseId: schema.kitBuilds.warehouseId,
      sourceLocationId: schema.kitBuilds.sourceLocationId,
      outputLocationId: schema.kitBuilds.outputLocationId,
      createdAt: schema.kitBuilds.createdAt,
      completedAt: schema.kitBuilds.completedAt,
      clientId: schema.kitBuilds.clientId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
    })
    .from(schema.kitBuilds)
    .innerJoin(schema.items, eq(schema.items.id, schema.kitBuilds.itemId))
    .where(and(eq(schema.kitBuilds.id, id), eq(schema.kitBuilds.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Kit build not found");
  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, row.itemId)))
    .limit(1);
  const components = bom
    ? await db
        .select({
          itemId: schema.bomLines.itemId,
          qty: schema.bomLines.qty,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.bomLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.bomLines.itemId))
        .where(eq(schema.bomLines.bomId, bom.id))
    : [];
  const asBuilt = await loadAsBuiltForRef(db, organizationId, row.id);
  return { ...row, remaining: remainingToComplete(row.qty, row.qtyCompleted), components, asBuilt };
}

kitsRoute.get("/kits", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.kitBuilds.id,
      number: schema.kitBuilds.number,
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
      status: schema.kitBuilds.status,
      warehouseId: schema.kitBuilds.warehouseId,
      sourceLocationId: schema.kitBuilds.sourceLocationId,
      outputLocationId: schema.kitBuilds.outputLocationId,
      createdAt: schema.kitBuilds.createdAt,
      completedAt: schema.kitBuilds.completedAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.kitBuilds)
    .innerJoin(schema.items, eq(schema.items.id, schema.kitBuilds.itemId))
    .where(eq(schema.kitBuilds.organizationId, organizationId))
    .orderBy(desc(schema.kitBuilds.createdAt));
  return c.json(rows.map((row) => ({ ...row, remaining: remainingToComplete(row.qty, row.qtyCompleted) })));
});

kitsRoute.get("/kits/:id", async (c) => {
  return c.json(await kitWithItem(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

kitsRoute.post("/kits", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    itemId?: string;
    qty?: number;
    sourceLocationId?: string;
    outputLocationId?: string;
    clientId?: string | null;
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
  if (!bom) badRequest("Create a recipe for this item before releasing a kit");
  const clientId = await optionalClientId(db, organizationId, body.clientId);

  const [row] = await db
    .insert(schema.kitBuilds)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("KIT"),
      itemId,
      qty,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId,
      outputLocationId,
      clientId,
      createdAt: Date.now(),
    })
    .returning();

  const created = await kitWithItem(db, organizationId, row.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "kit",
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

kitsRoute.post("/kits/:id/complete", async (c) => {
  const body = await c.req
    .json<{ qty?: number; lotCode?: string; serials?: string | string[] }>()
    .catch(() => ({}) as { qty?: number; lotCode?: string; serials?: string | string[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const kit = await kitWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteKit(kit.status)) conflict("Kit already completed");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: kit.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "kit",
    refId: kit.id,
    verb: "kit",
    number: kit.number,
    title: `${kit.sku} × ${kit.qty}`,
    fromLocationId: kit.sourceLocationId,
    toLocationId: kit.outputLocationId,
    itemId: kit.itemId,
    createdAt: kit.createdAt,
  });
  if (kit.components.length === 0) badRequest("BOM is missing");

  const remaining = remainingToComplete(kit.qty, kit.qtyCompleted);
  if (remaining <= 0) conflict("Kit has nothing remaining");
  let thisQty = remaining;
  if (body.qty !== undefined && body.qty !== null) {
    thisQty = requireInt(body.qty, "qty");
  }
  let applied;
  try {
    applied = applyPartialComplete({ sku: kit.sku, qty: kit.qty, qtyCompleted: kit.qtyCompleted }, thisQty);
  } catch (err) {
    if (err instanceof OverCompleteError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid complete qty");
  }

  const pairs = [
    ...kit.components.map((line) => ({ locationId: kit.sourceLocationId, itemId: line.itemId })),
    { locationId: kit.outputLocationId, itemId: kit.itemId },
  ];
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const serials = parseSerialList(body.serials);
  const plan = planCompleteKit({
    kitId: kit.id,
    finishedItemId: kit.itemId,
    finishedSku: kit.sku,
    qty: applied.postedQty,
    sourceLocationId: kit.sourceLocationId,
    outputLocationId: kit.outputLocationId,
    bomLines: kit.components,
    balances: qtyMap(loaded),
    outputLotCode: body.lotCode?.trim() || null,
    outputSerials: serials.length ? serials : null,
  });
  stampProducedClient(plan, kit.clientId);

  const now = Date.now();
  const nextStatus = isFullyCompleted(kit.qty, applied.qtyCompleted) ? "completed" : "in_progress";
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.kitBuilds)
        .set({
          status: nextStatus,
          qtyCompleted: applied.qtyCompleted,
          completedAt: nextStatus === "completed" ? now : kit.completedAt,
        })
        .where(eq(schema.kitBuilds.id, kit.id)),
    ],
  });

  const completed = await kitWithItem(db, organizationId, kit.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: completed.warehouseId,
    refType: "kit",
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

kitsRoute.post("/kits/:id/dekit", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const kit = await kitWithItem(db, organizationId, c.req.param("id"));
  if (!canDekit(kit.status)) conflict("Dekit is only for a fully completed kit");
  if (kit.asBuilt.length === 0) badRequest("Kit has no as-built to reverse");

  const pairs = [
    { locationId: kit.outputLocationId, itemId: kit.itemId },
    ...kit.asBuilt.map((row) => ({ locationId: kit.sourceLocationId, itemId: row.componentItemId })),
  ];
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const plan = planDekit({
    kitId: kit.id,
    finishedItemId: kit.itemId,
    finishedSku: kit.sku,
    qty: kit.qtyCompleted || kit.qty,
    sourceLocationId: kit.sourceLocationId,
    outputLocationId: kit.outputLocationId,
    asBuilt: kit.asBuilt,
    balances: qtyMap(loaded),
  });

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.kitBuilds)
        .set({ status: "dekitted", completedAt: now })
        .where(eq(schema.kitBuilds.id, kit.id)),
    ],
  });

  const dekitted = await kitWithItem(db, organizationId, kit.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: dekitted.warehouseId,
    refType: "kit",
    refId: dekitted.id,
    status: dekitted.status,
    number: dekitted.number,
    title: `${dekitted.sku} × ${dekitted.qty}`,
    fromLocationId: dekitted.sourceLocationId,
    toLocationId: dekitted.outputLocationId,
    itemId: dekitted.itemId,
    createdAt: dekitted.createdAt,
  });
  return c.json(dekitted);
});

