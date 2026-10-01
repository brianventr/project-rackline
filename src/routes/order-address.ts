import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound } from "../lib/http";
import { acceptOrderAddress, applySuggestedAddress, orderAddressVerdict } from "../db/address-checks";
import { loadCarrierConnections } from "./carriers";
import { AddressInvalidError } from "../domain/address-check";
import { destPatchFromAddress } from "../domain/geo";

export const orderAddressRoute = new Hono<AppEnv>();

type Db = AppEnv["Variables"]["db"];

/** The ship-to address can change until a label is bought to it; `locked` says why it no longer can. */
async function loadAddressOrder(db: Db, organizationId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) notFound("Order not found");
  const [carton] = await db
    .select({ id: schema.orderPackages.id })
    .from(schema.orderPackages)
    .where(and(eq(schema.orderPackages.orderId, order.id), eq(schema.orderPackages.labelStatus, "purchased")))
    .limit(1);
  const [warehouse] = await db
    .select({ country: schema.warehouses.country })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, order.warehouseId))
    .limit(1);
  const locked =
    order.status === "shipped" || order.status === "cancelled"
      ? `This order is ${order.status}, so its address stays as it is`
      : order.labelStatus === "purchased" || carton
        ? "This order has a label. Void it before changing the address"
        : null;
  return { order, buildingCountry: warehouse?.country ?? null, locked };
}

/** The check a label purchase and quick-ship run on the order's ship-to address, for the order page. */
orderAddressRoute.get("/orders/:id/address", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const { order, buildingCountry, locked } = await loadAddressOrder(db, organizationId, c.req.param("id"));
  const base = { orderId: order.id, editable: !locked, blocked: false, overridden: false, message: null, suggestion: null };
  if (locked) return c.json(base);
  const verdict = await orderAddressVerdict(db, organizationId, {
    order,
    buildingCountry,
    connections: await loadCarrierConnections(db, organizationId),
    verify: true,
  });
  const { message, suggestion } = verdict.blocked ? new AddressInvalidError(verdict) : { message: null, suggestion: null };
  return c.json({ ...base, blocked: verdict.blocked, overridden: verdict.overridden, message, suggestion });
});

orderAddressRoute.put("/orders/:id/address", async (c) => {
  const body = await c.req.json<{ shipToAddress?: unknown }>().catch(() => ({}) as { shipToAddress?: unknown });
  const text = typeof body.shipToAddress === "string" ? body.shipToAddress.trim() : "";
  if (!text) badRequest("Type the ship-to address");
  if (text.length > 500) badRequest("The ship-to address is too long");
  const db = c.get("db");
  const { order, locked } = await loadAddressOrder(db, c.get("organizationId")!, c.req.param("id"));
  if (locked) conflict(locked);
  const patch = destPatchFromAddress(text);
  // A retyped street with no country line stays in the order's country.
  await db
    .update(schema.orders)
    .set({ ...patch, shipToCountry: patch.shipToCountry ?? order.shipToCountry })
    .where(eq(schema.orders.id, order.id));
  return c.json({ orderId: order.id, shipToAddress: patch.shipToAddress });
});

orderAddressRoute.post("/orders/:id/address/use-suggestion", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const { order, buildingCountry, locked } = await loadAddressOrder(db, organizationId, c.req.param("id"));
  if (locked) conflict(locked);
  const applied = await applySuggestedAddress(db, organizationId, { order, buildingCountry });
  if (!applied) conflict("The carrier has not suggested an address for this one");
  return c.json({ orderId: order.id, shipToAddress: applied.shipToAddress });
});

/** "Ship anyway to this address" outside quick-ship: labels for this order may be bought to the address as it is. */
orderAddressRoute.post("/orders/:id/address/accept", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const { order, buildingCountry, locked } = await loadAddressOrder(db, organizationId, c.req.param("id"));
  if (locked) conflict(locked);
  await acceptOrderAddress(db, organizationId, { order, buildingCountry, userId: c.get("user")!.id });
  return c.json({ orderId: order.id, editable: true, blocked: false, overridden: true, message: null, suggestion: null });
});
