import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";

export const clientsRoute = new Hono<AppEnv>();

clientsRoute.get("/clients", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId))
    .orderBy(schema.clients.code);
  return c.json(rows);
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
  return c.json(row, 201);
});

clientsRoute.patch("/clients/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ code?: string; name?: string }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, c.req.param("id")), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
  const patch: { code?: string; name?: string } = {};
  if (body.code?.trim()) patch.code = body.code.trim().toUpperCase();
  if (body.name?.trim()) patch.name = body.name.trim();
  if (Object.keys(patch).length === 0) badRequest("No client fields to update");
  const [row] = await db.update(schema.clients).set(patch).where(eq(schema.clients.id, client.id)).returning();
  return c.json(row);
});

clientsRoute.delete("/clients/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, c.req.param("id")), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
  await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
  return c.body(null, 204);
});
