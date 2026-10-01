import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { newId } from "../lib/ids";
import { isEmailAddress } from "../domain/purchase-mail";
import { parseChannelRefs } from "../domain/parties";
import { isOpenOrder } from "../domain/status";

export const customersRoute = new Hono<AppEnv>();

type CustomerBody = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  shipToAddress?: string | null;
  notes?: string | null;
};

type CustomerPatch = Partial<Pick<typeof schema.customers.$inferInsert, "name" | "email" | "phone" | "shipToAddress" | "notes">>;

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function customerPatch(body: CustomerBody): CustomerPatch {
  const patch: CustomerPatch = {};
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  if (body.email !== undefined) {
    const email = text(body.email);
    if (email && !isEmailAddress(email)) badRequest("Customer email must be a full address, like sam@example.com");
    patch.email = email;
  }
  if (body.phone !== undefined) patch.phone = text(body.phone);
  if (body.shipToAddress !== undefined) patch.shipToAddress = text(body.shipToAddress);
  if (body.notes !== undefined) patch.notes = text(body.notes);
  return patch;
}

async function assertEmailFree(db: AppEnv["Variables"]["db"], organizationId: string, email: string, exceptId?: string) {
  const [taken] = await db
    .select({ id: schema.customers.id, name: schema.customers.name })
    .from(schema.customers)
    .where(and(eq(schema.customers.organizationId, organizationId), sql`lower(trim(${schema.customers.email})) = lower(${email})`))
    .limit(1);
  if (taken && taken.id !== exceptId) conflict(`${taken.name} already uses ${email}`);
}

function withRefs<T extends { channelRefsJson: string | null }>(row: T) {
  return { ...row, channelRefs: parseChannelRefs(row.channelRefsJson) };
}

customersRoute.get("/customers", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.organizationId, organizationId))
    .orderBy(schema.customers.name);
  const stats = await db
    .select({
      customerId: schema.orders.customerId,
      orders: sql<number>`count(*)`,
      open: sql<number>`sum(case when ${schema.orders.status} not in ('shipped', 'cancelled') then 1 else 0 end)`,
      lastAt: sql<number | null>`max(${schema.orders.createdAt})`,
    })
    .from(schema.orders)
    .where(eq(schema.orders.organizationId, organizationId))
    .groupBy(schema.orders.customerId);
  const returns = await db
    .select({ customerId: schema.rmas.customerId, returns: sql<number>`count(*)` })
    .from(schema.rmas)
    .where(eq(schema.rmas.organizationId, organizationId))
    .groupBy(schema.rmas.customerId);
  const byCustomer = new Map(stats.map((row) => [row.customerId, row]));
  const returnsByCustomer = new Map(returns.map((row) => [row.customerId, Number(row.returns)]));
  return c.json(
    rows.map((row) => {
      const stat = byCustomer.get(row.id);
      return {
        ...withRefs(row),
        orderCount: Number(stat?.orders ?? 0),
        openOrderCount: Number(stat?.open ?? 0),
        lastOrderAt: stat?.lastAt ?? null,
        returnCount: returnsByCustomer.get(row.id) ?? 0,
      };
    }),
  );
});

customersRoute.post("/customers", async (c) => {
  const body = await c.req.json<CustomerBody>();
  const patch = customerPatch({ ...body, name: requireString(body.name, "name") });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  if (patch.email) await assertEmailFree(db, organizationId, patch.email);
  const now = Date.now();
  const [row] = await db
    .insert(schema.customers)
    .values({ ...patch, id: newId(), organizationId, name: patch.name!, createdAt: now, updatedAt: now })
    .returning();
  return c.json(withRefs(row!), 201);
});

customersRoute.get("/customers/:id", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.organizationId, organizationId)))
    .limit(1);
  if (!customer) notFound("Customer not found");
  const orders = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.customerId, customer.id)))
    .orderBy(desc(schema.orders.createdAt));
  const lines = orders.length
    ? await db
        .select({ orderId: schema.orderLines.orderId, qty: schema.orderLines.qty, sku: schema.items.sku, itemName: schema.items.name })
        .from(schema.orderLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
        .where(
          inArray(
            schema.orderLines.orderId,
            orders.map((row) => row.id),
          ),
        )
    : [];
  const returns = await db
    .select()
    .from(schema.rmas)
    .where(and(eq(schema.rmas.organizationId, organizationId), eq(schema.rmas.customerId, customer.id)))
    .orderBy(desc(schema.rmas.createdAt));
  return c.json({
    customer: withRefs(customer),
    orders: orders.map((row) => ({
      ...row,
      open: isOpenOrder(row.status),
      lines: lines
        .filter((line) => line.orderId === row.id)
        .map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qty })),
    })),
    returns,
  });
});

customersRoute.patch("/customers/:id", async (c) => {
  const body = await c.req.json<CustomerBody>();
  const patch = customerPatch(body);
  if (Object.keys(patch).length === 0) badRequest("No customer fields to update");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.organizationId, organizationId)))
    .limit(1);
  if (!customer) notFound("Customer not found");
  if (patch.email) await assertEmailFree(db, organizationId, patch.email, customer.id);
  const [row] = await db
    .update(schema.customers)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.customers.id, customer.id))
    .returning();
  return c.json(withRefs(row!));
});
