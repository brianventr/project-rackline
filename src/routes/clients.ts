import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { newPublicToken } from "../domain/public-token";

export const clientsRoute = new Hono<AppEnv>();

type ClientRow = typeof schema.clients.$inferSelect;

function presentClient(row: ClientRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt,
    storageCentsPerPiece: row.storageCentsPerPiece,
    pickCentsPerUnit: row.pickCentsPerUnit,
    cartonCents: row.cartonCents,
    returnCents: row.returnCents,
    portalEnabled: Boolean(row.portalToken),
  };
}

function optionalCents(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    badRequest(`${field} must be a whole number of cents, or null for the organization rate`);
  }
  return value;
}

async function loadClient(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, id), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
  return client;
}

clientsRoute.get("/clients", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId))
    .orderBy(schema.clients.code);
  return c.json(rows.map(presentClient));
});

clientsRoute.post("/clients", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ code?: string; name?: string }>();
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [row] = await db
    .insert(schema.clients)
    .values({
      id: newId(),
      organizationId,
      code,
      name,
      createdAt: Date.now(),
    })
    .returning();
  return c.json(presentClient(row!), 201);
});

clientsRoute.put("/clients/:id/rates", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    storageCentsPerPiece?: unknown;
    pickCentsPerUnit?: unknown;
    cartonCents?: unknown;
    returnCents?: unknown;
  }>();
  const storageCentsPerPiece = optionalCents(body.storageCentsPerPiece, "storageCentsPerPiece");
  const pickCentsPerUnit = optionalCents(body.pickCentsPerUnit, "pickCentsPerUnit");
  const cartonCents = optionalCents(body.cartonCents, "cartonCents");
  const returnCents = optionalCents(body.returnCents, "returnCents");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const client = await loadClient(db, organizationId, c.req.param("id"));
  const patch: Partial<Pick<ClientRow, "storageCentsPerPiece" | "pickCentsPerUnit" | "cartonCents" | "returnCents">> = {};
  if (storageCentsPerPiece !== undefined) patch.storageCentsPerPiece = storageCentsPerPiece;
  if (pickCentsPerUnit !== undefined) patch.pickCentsPerUnit = pickCentsPerUnit;
  if (cartonCents !== undefined) patch.cartonCents = cartonCents;
  if (returnCents !== undefined) patch.returnCents = returnCents;
  if (Object.keys(patch).length === 0) badRequest("No rate fields to update");
  const [row] = await db.update(schema.clients).set(patch).where(eq(schema.clients.id, client.id)).returning();
  return c.json(presentClient(row!));
});

clientsRoute.post("/clients/:id/portal-token", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const client = await loadClient(db, organizationId, c.req.param("id"));
  const portalToken = newPublicToken();
  await db.update(schema.clients).set({ portalToken }).where(eq(schema.clients.id, client.id));
  return c.json({ portalToken, path: `/portal/c/${portalToken}` });
});

clientsRoute.patch("/clients/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ code?: string; name?: string }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const client = await loadClient(db, organizationId, c.req.param("id"));
  const patch: { code?: string; name?: string } = {};
  if (body.code?.trim()) patch.code = body.code.trim().toUpperCase();
  if (body.name?.trim()) patch.name = body.name.trim();
  if (Object.keys(patch).length === 0) badRequest("No client fields to update");
  const [row] = await db.update(schema.clients).set(patch).where(eq(schema.clients.id, client.id)).returning();
  return c.json(presentClient(row!));
});

clientsRoute.get("/clients/:id/stock", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const client = await loadClient(db, organizationId, c.req.param("id"));
  const rows = await db
    .select({
      qty: schema.clientBalances.qty,
      updatedAt: schema.clientBalances.updatedAt,
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      warehouseId: schema.locations.warehouseId,
    })
    .from(schema.clientBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.clientBalances.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.clientBalances.itemId))
    .where(and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.clientBalances.clientId, client.id)))
    .orderBy(schema.items.sku, schema.locations.code);
  return c.json({ client: presentClient(client), stock: rows });
});

clientsRoute.delete("/clients/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const client = await loadClient(db, organizationId, c.req.param("id"));
  await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
  return c.body(null, 204);
});
