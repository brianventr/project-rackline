import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { createAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { originFrom } from "../lib/types";
import { isRateKind, type RateKind } from "../domain/billing";

export const clientsRoute = new Hono<AppEnv>();

async function ratesFor(db: AppEnv["Variables"]["db"], organizationId: string, clientIds?: string[]) {
  const rows = await db
    .select()
    .from(schema.clientRates)
    .where(eq(schema.clientRates.organizationId, organizationId));
  const map = new Map<string, Partial<Record<RateKind, number>>>();
  for (const row of rows) {
    if (clientIds && !clientIds.includes(row.clientId)) continue;
    if (!isRateKind(row.kind)) continue;
    const card = map.get(row.clientId) ?? {};
    card[row.kind] = row.unitCents;
    map.set(row.clientId, card);
  }
  return map;
}

function present(
  row: typeof schema.clients.$inferSelect,
  rates: Partial<Record<RateKind, number>> | undefined,
) {
  return { ...row, rates: rates ?? {} };
}

async function applyRates(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  clientId: string,
  rates: Record<string, unknown> | undefined,
) {
  if (!rates) return;
  for (const [kind, raw] of Object.entries(rates)) {
    if (!isRateKind(kind)) badRequest("Unknown rate");
    if (raw === null || raw === "") {
      await db
        .delete(schema.clientRates)
        .where(and(eq(schema.clientRates.clientId, clientId), eq(schema.clientRates.kind, kind)));
      continue;
    }
    const unitCents = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(unitCents) || unitCents < 0) badRequest(`${kind} rate must be a whole number of cents`);
    const [existing] = await db
      .select()
      .from(schema.clientRates)
      .where(and(eq(schema.clientRates.clientId, clientId), eq(schema.clientRates.kind, kind)))
      .limit(1);
    if (existing) {
      await db.update(schema.clientRates).set({ unitCents }).where(eq(schema.clientRates.id, existing.id));
    } else {
      await db.insert(schema.clientRates).values({
        id: newId(),
        organizationId,
        clientId,
        kind,
        unitCents,
      });
    }
  }
}

clientsRoute.get("/clients", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId))
    .orderBy(schema.clients.code);
  const rates = await ratesFor(db, organizationId);
  return c.json(rows.map((row) => present(row, rates.get(row.id))));
});

clientsRoute.post("/clients", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    code?: string;
    name?: string;
    billingEmail?: string | null;
    rates?: Record<string, unknown>;
  }>();
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = newId();
  await db.insert(schema.clients).values({
    id,
    organizationId,
    code,
    name,
    billingEmail: body.billingEmail?.trim() || null,
    createdAt: Date.now(),
  });
  await applyRates(db, organizationId, id, body.rates);
  const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1);
  const rates = await ratesFor(db, organizationId, [id]);
  return c.json(present(row!, rates.get(id)), 201);
});

clientsRoute.patch("/clients/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    code?: string;
    name?: string;
    billingEmail?: string | null;
    rates?: Record<string, unknown>;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, c.req.param("id")), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
  const patch: { code?: string; name?: string; billingEmail?: string | null } = {};
  if (body.code?.trim()) patch.code = body.code.trim().toUpperCase();
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.billingEmail !== undefined) patch.billingEmail = body.billingEmail?.trim() || null;
  if (Object.keys(patch).length === 0 && !body.rates) badRequest("No client fields to update");
  if (Object.keys(patch).length > 0) {
    await db.update(schema.clients).set(patch).where(eq(schema.clients.id, client.id));
  }
  await applyRates(db, organizationId, client.id, body.rates);
  const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, client.id)).limit(1);
  const rates = await ratesFor(db, organizationId, [client.id]);
  return c.json(present(row!, rates.get(client.id)));
});

clientsRoute.post("/clients/:id/portal", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ name?: string; email?: string; password?: string }>();
  const name = requireString(body.name, "name");
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  if (password.length < 8) badRequest("Password must be at least 8 characters");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, c.req.param("id")), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
  const [existingUser] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (existingUser) {
    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, existingUser.id)))
      .limit(1);
    if (membership) conflict("That person is already on this team");
    conflict("That email already has a Rackline login. Invite them from a fresh email for now.");
  }
  const origin = originFrom(c.req.url);
  const auth = createAuth(db, c.env, origin);
  const result = await auth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers(),
    asResponse: true,
  });
  if (!result.ok) {
    const payload = (await result.json().catch(() => ({ message: "Could not create portal login" }))) as {
      message?: string;
      error?: { message?: string };
    };
    return c.json({ error: payload.error?.message || payload.message || "Could not create portal login" }, 400);
  }
  const signed = (await result.clone().json()) as { user?: { id: string } };
  const userId = signed.user?.id;
  if (!userId) return c.json({ error: "Could not create portal login" }, 400);
  await db.insert(schema.memberships).values({
    id: newId(),
    organizationId,
    userId,
    role: "client",
    clientId: client.id,
  });
  return c.json({ userId, email, name, clientId: client.id, role: "client" }, 201);
});

clientsRoute.get("/clients/:id/stock", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const clientId = c.req.param("id");
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizationId)))
    .limit(1);
  if (!client) notFound("Client not found");
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
    .where(and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.clientBalances.clientId, clientId)))
    .orderBy(schema.items.sku, schema.locations.code);
  const rates = await ratesFor(db, organizationId, [clientId]);
  return c.json({ client: present(client, rates.get(clientId)), stock: rows });
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
