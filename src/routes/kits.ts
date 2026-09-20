import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { planCompleteKit } from "../domain/manufacturing";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { canCompleteKit } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { loadAsBuiltForRef } from "../db/as-built";

export const kitsRoute = new Hono<AppEnv>();

async function kitWithItem(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.kitBuilds.id,
      number: schema.kitBuilds.number,
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      status: schema.kitBuilds.status,
      warehouseId: schema.kitBuilds.warehouseId,
      sourceLocationId: schema.kitBuilds.sourceLocationId,
      outputLocationId: schema.kitBuilds.outputLocationId,
      createdAt: schema.kitBuilds.createdAt,
      completedAt: schema.kitBuilds.completedAt,
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
  return { ...row, components, asBuilt };
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
  return c.json(rows);
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

  const [row] = await db
    .insert(schema.kitBuilds)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("KIT"),
      itemId,
      qty,
      status: "draft",
      sourceLocationId,
      outputLocationId,
      createdAt: Date.now(),
    })
    .returning();

  return c.json(await kitWithItem(db, organizationId, row.id), 201);
});

kitsRoute.post("/kits/:id/complete", async (c) => {
  const body = await c.req
    .json<{ lotCode?: string; serials?: string | string[] }>()
    .catch(() => ({}) as { lotCode?: string; serials?: string | string[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const kit = await kitWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteKit(kit.status)) conflict("Kit already completed");
  if (kit.components.length === 0) badRequest("BOM is missing");

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
    qty: kit.qty,
    sourceLocationId: kit.sourceLocationId,
    outputLocationId: kit.outputLocationId,
    bomLines: kit.components,
    balances: qtyMap(loaded),
    outputLotCode: body.lotCode?.trim() || null,
    outputSerials: serials.length ? serials : null,
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
        .set({ status: "completed", completedAt: now })
        .where(eq(schema.kitBuilds.id, kit.id)),
    ],
  });

  return c.json(await kitWithItem(db, organizationId, kit.id));
});
