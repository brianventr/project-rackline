import { and, asc, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { releaseDocumentKind, usualBays } from "../domain/build-request";
import { badRequest, conflict, notFound } from "../lib/http";
import { docNumber, newId } from "../lib/ids";
import { syncDocumentJob } from "./jobs";

export type BuildRequestRow = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  qty: number;
  status: string;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  createdAt: number;
};

export async function listBuildRequests(
  db: AppDb,
  organizationId: string,
  filter?: { clientId?: string; status?: string },
): Promise<BuildRequestRow[]> {
  const rows = await db
    .select({
      id: schema.buildRequests.id,
      clientId: schema.buildRequests.clientId,
      clientCode: schema.clients.code,
      clientName: schema.clients.name,
      itemId: schema.buildRequests.itemId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
      qty: schema.buildRequests.qty,
      status: schema.buildRequests.status,
      refType: schema.buildRequests.refType,
      refId: schema.buildRequests.refId,
      createdAt: schema.buildRequests.createdAt,
    })
    .from(schema.buildRequests)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.buildRequests.clientId))
    .innerJoin(schema.items, eq(schema.items.id, schema.buildRequests.itemId))
    .where(
      and(
        eq(schema.buildRequests.organizationId, organizationId),
        filter?.clientId ? eq(schema.buildRequests.clientId, filter.clientId) : undefined,
        filter?.status ? eq(schema.buildRequests.status, filter.status) : undefined,
      ),
    )
    .orderBy(asc(schema.buildRequests.createdAt));
  const withNumbers: BuildRequestRow[] = [];
  for (const row of rows) {
    let refNumber: string | null = null;
    if (row.refType === "kit" && row.refId) {
      const [kit] = await db
        .select({ number: schema.kitBuilds.number })
        .from(schema.kitBuilds)
        .where(eq(schema.kitBuilds.id, row.refId))
        .limit(1);
      refNumber = kit?.number ?? null;
    }
    if (row.refType === "workOrder" && row.refId) {
      const [order] = await db
        .select({ number: schema.workOrders.number })
        .from(schema.workOrders)
        .where(eq(schema.workOrders.id, row.refId))
        .limit(1);
      refNumber = order?.number ?? null;
    }
    withNumbers.push({ ...row, refNumber });
  }
  return withNumbers;
}

export async function recipeChoices(db: AppDb, organizationId: string) {
  const rows = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
    })
    .from(schema.boms)
    .innerJoin(schema.items, eq(schema.items.id, schema.boms.itemId))
    .where(eq(schema.boms.organizationId, organizationId))
    .orderBy(schema.items.sku);
  return rows.filter((row) => row.itemType === "finished" || row.itemType === "wip");
}

async function loadRequest(db: AppDb, organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.buildRequests)
    .where(and(eq(schema.buildRequests.id, id), eq(schema.buildRequests.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Build request not found");
  return row;
}

export async function createBuildRequest(
  db: AppDb,
  organizationId: string,
  input: { clientId: string; itemId: string; qty: number },
) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) badRequest("Quantity must be a positive integer");
  const [item] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, input.itemId), eq(schema.items.organizationId, organizationId)))
    .limit(1);
  if (!item) notFound("Item not found");
  try {
    releaseDocumentKind(item.type);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "That SKU cannot be requested");
  }
  const [bom] = await db
    .select({ id: schema.boms.id })
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, item.id)))
    .limit(1);
  if (!bom) badRequest("That SKU has no recipe");
  const id = newId();
  await db.insert(schema.buildRequests).values({
    id,
    organizationId,
    clientId: input.clientId,
    itemId: item.id,
    qty: input.qty,
    status: "requested",
    createdAt: Date.now(),
  });
  const created = await listBuildRequests(db, organizationId, { clientId: input.clientId });
  const row = created.find((entry) => entry.id === id);
  if (!row) notFound("Build request not found");
  return row;
}

export async function cancelBuildRequest(db: AppDb, organizationId: string, id: string) {
  const request = await loadRequest(db, organizationId, id);
  if (request.status !== "requested") conflict("Only an open request can be cancelled", "NOT_OPEN");
  await db
    .update(schema.buildRequests)
    .set({ status: "cancelled", cancelledAt: Date.now() })
    .where(eq(schema.buildRequests.id, request.id));
  const rows = await listBuildRequests(db, organizationId);
  return rows.find((row) => row.id === request.id)!;
}

export async function releaseBuildRequest(db: AppDb, organizationId: string, id: string) {
  const request = await loadRequest(db, organizationId, id);
  if (request.status !== "requested") conflict("Only an open request can be released", "NOT_OPEN");
  const [item] = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, request.itemId))
    .limit(1);
  if (!item) notFound("Item not found");
  const kind = releaseDocumentKind(item.type);
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId))
    .orderBy(asc(schema.warehouses.createdAt))
    .limit(1);
  if (!warehouse) conflict("No warehouse to release into", "NO_BAY");
  const locations = await db
    .select({ id: schema.locations.id, type: schema.locations.type, slotRole: schema.locations.slotRole })
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouse.id)));
  const bays = usualBays(locations);
  if (!bays) conflict("No bay to consume from", "NO_BAY");
  const now = Date.now();
  const docId = newId();
  const refType = kind === "kit" ? "kit" : "workOrder";
  const outputId = kind === "kit" ? bays.kitOutputId : bays.workOrderOutputId;
  const number = docNumber(kind === "kit" ? "KIT" : "WO");
  if (kind === "kit") {
    await db.insert(schema.kitBuilds).values({
      id: docId,
      organizationId,
      warehouseId: warehouse.id,
      number,
      itemId: item.id,
      qty: request.qty,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId: bays.sourceId,
      outputLocationId: outputId,
      clientId: request.clientId,
      createdAt: now,
    });
  } else {
    await db.insert(schema.workOrders).values({
      id: docId,
      organizationId,
      warehouseId: warehouse.id,
      number,
      itemId: item.id,
      qty: request.qty,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId: bays.sourceId,
      outputLocationId: outputId,
      clientId: request.clientId,
      createdAt: now,
    });
  }
  await db
    .update(schema.buildRequests)
    .set({
      status: "released",
      warehouseId: warehouse.id,
      refType,
      refId: docId,
      releasedAt: now,
    })
    .where(eq(schema.buildRequests.id, request.id));
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: warehouse.id,
    refType,
    refId: docId,
    status: "draft",
    number,
    title: `${item.sku} × ${request.qty}`,
    fromLocationId: bays.sourceId,
    toLocationId: outputId,
    itemId: item.id,
    qty: request.qty,
    createdAt: now,
  });
  const rows = await listBuildRequests(db, organizationId);
  return rows.find((row) => row.id === request.id)!;
}
