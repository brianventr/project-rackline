import { Hono } from "hono";
import { createDb } from "./db/client";
import { createAuth } from "./lib/auth";
import { getMembership } from "./lib/org";
import { HttpError } from "./lib/http";
import { InsufficientStockError } from "./domain/inventory";
import type { AppEnv } from "./lib/types";
import { originFrom } from "./lib/types";
import { registerRoute } from "./routes/register";
import { demoRoute } from "./routes/demo";
import { meRoute } from "./routes/me";
import { catalogRoute } from "./routes/catalog";
import { receiptsRoute } from "./routes/receipts";
import { ordersRoute } from "./routes/orders";
import { adjustmentsRoute } from "./routes/adjustments";
import { manufacturingRoute } from "./routes/manufacturing";
import { shopifyPublicRoute, shopifyRoute } from "./routes/shopify";
import { ShopifyIngestError } from "./domain/shopify-ingest";
import { floorRoute } from "./routes/floor";
import { layoutRoute } from "./routes/layout";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof InsufficientStockError) {
    return c.json(
      {
        error: err.message,
        code: "INSUFFICIENT_STOCK",
        sku: err.sku,
        onHand: err.onHand,
        needed: err.needed,
      },
      409,
    );
  }
  if (err instanceof ShopifyIngestError) {
    return c.json({ error: err.message }, err.status as 400 | 409);
  }
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 409);
  }
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

app.use("/api/*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  c.set("origin", originFrom(c.req.url));
  await next();
});

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.get("db"), c.env, c.get("origin"));
  return auth.handler(c.req.raw);
});

app.route("/api", registerRoute);
app.route("/api", demoRoute);
app.route("/api", shopifyPublicRoute);

app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/api/auth") ||
    path === "/api/register" ||
    path === "/api/demo/seed" ||
    path === "/api/shopify/webhooks" ||
    path === "/api/shopify/fulfillment_order_notification"
  ) {
    return next();
  }
  const auth = createAuth(c.get("db"), c.env, c.get("origin"));
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const membership = await getMembership(c.get("db"), session.user.id);
  if (!membership) {
    return c.json({ error: "No organization for this user" }, 403);
  }
  c.set("user", {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  });
  c.set("organizationId", membership.organizationId);
  c.set("role", membership.role as "owner" | "operator");
  await next();
});

app.route("/api", meRoute);
app.route("/api", catalogRoute);
app.route("/api", receiptsRoute);
app.route("/api", ordersRoute);
app.route("/api", adjustmentsRoute);
app.route("/api", manufacturingRoute);
app.route("/api", shopifyRoute);
app.route("/api", floorRoute);
app.route("/api", layoutRoute);

export default app;
