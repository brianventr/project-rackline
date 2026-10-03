import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { normalizeShopDomain } from "../domain/shopify";
import { askPromise, parsePromiseQty, parsePromiseSku, planPromises, storefrontPromiseLine } from "../domain/promise";
import { loadPromiseFacts } from "../db/promise";

export const promisePublicRoute = new Hono<AppEnv>();

function cors(c: { header: (name: string, value: string) => void }) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
}

promisePublicRoute.options("/shopify/promise", (c) => {
  cors(c);
  return c.body(null, 204);
});

/** The one line a product page can show. It does not reserve stock. */
promisePublicRoute.get("/shopify/promise", async (c) => {
  cors(c);
  const shop = c.req.query("shop")?.trim();
  if (!shop) return c.json({ line: null, reservesStock: false, error: "shop is required" }, 400);
  let sku: string;
  let qty: number;
  try {
    sku = parsePromiseSku(c.req.query("sku"));
    qty = parsePromiseQty(c.req.query("qty") ?? "1");
  } catch (err) {
    return c.json({ line: null, reservesStock: false, error: err instanceof Error ? err.message : "Invalid promise" }, 400);
  }
  const db = c.get("db");
  const [connection] = await db
    .select({ organizationId: schema.shopifyConnections.organizationId })
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.shopDomain, normalizeShopDomain(shop)))
    .limit(1);
  if (!connection) return c.json({ line: null, reservesStock: false }, 404);
  const [warehouse] = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, connection.organizationId))
    .limit(1);
  if (!warehouse) return c.json({ line: null, reservesStock: false }, 404);
  const facts = await loadPromiseFacts(db, connection.organizationId, warehouse.id);
  const item = facts.items.find((row) => row.sku.toLowerCase() === sku.toLowerCase());
  if (!item) return c.json({ line: null, reservesStock: false }, 404);
  const plan = planPromises(facts.input);
  const ask = askPromise(
    plan,
    { itemId: item.itemId, sku: item.sku, name: item.name, qty },
    facts.input.now,
    facts.input.timeZone,
    facts.input.pacePerHour ?? null,
  );
  return c.json({
    line: storefrontPromiseLine(ask),
    reservesStock: false,
    code: ask.code,
    cutoffLabel: ask.cutoffLabel,
    shipDay: ask.shipDay,
  });
});
