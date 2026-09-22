import { Hono } from "hono";
import { createDb } from "./db/client";
import { createAuth } from "./lib/auth";
import { getMembership } from "./lib/org";
import { mapDomainError } from "./lib/error-response";
import { originFrom, type AppEnv } from "./lib/types";
import { newId } from "./lib/ids";
import * as schema from "./db/schema";
import {
  auditAction,
  auditSummary,
  codeFromBody,
  serializeAuditPayload,
  shouldAudit,
} from "./domain/audit";
import { registerRoute } from "./routes/register";
import { demoRoute } from "./routes/demo";
import { meRoute } from "./routes/me";
import { organizationRoute } from "./routes/organization";
import { catalogRoute } from "./routes/catalog";
import { receiptsRoute } from "./routes/receipts";
import { purchasesRoute } from "./routes/purchases";
import { ordersRoute } from "./routes/orders";
import { returnsRoute } from "./routes/returns";
import { adjustmentsRoute } from "./routes/adjustments";
import { manufacturingRoute } from "./routes/manufacturing";
import { shopifyPublicRoute, shopifyRoute } from "./routes/shopify";
import { carriersRoute, carriersPublicRoute } from "./routes/carriers";
import { floorRoute } from "./routes/floor";
import { searchRoute } from "./routes/search";
import { teamRoute } from "./routes/team";
import { layoutRoute } from "./routes/layout";
import { replenishmentsRoute } from "./routes/replenishments";
import { kitsRoute } from "./routes/kits";
import { holdsRoute } from "./routes/holds";
import { vendorReturnsRoute } from "./routes/vendor-returns";
import { jobsRoute } from "./routes/jobs";
import { wavesRoute } from "./routes/waves";
import { asnsRoute } from "./routes/asns";
import { zonesRoute } from "./routes/zones";
import { clientsRoute } from "./routes/clients";
import { yardRoute } from "./routes/yard";
import { laborRoute } from "./routes/labor";
import { printersRoute } from "./routes/printers";
import { billingRoute } from "./routes/billing";
import { ediRoute } from "./routes/edi";
import { equipmentRoute } from "./routes/equipment";
import { analyticsRoute } from "./routes/analytics";
import { mediaRoute } from "./routes/media";
import { auditRoute } from "./routes/audit";
import { liveRoute } from "./routes/live";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  const mapped = mapDomainError(err);
  if (mapped) return c.json(mapped.body, mapped.status);
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
app.route("/api", carriersPublicRoute);

app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/api/auth") ||
    path === "/api/register" ||
    path === "/api/demo/seed" ||
    path === "/api/shopify/webhooks" ||
    path === "/api/shopify/fulfillment_order_notification" ||
    path === "/api/shopify/oauth/callback" ||
    path === "/api/carriers/trackers/webhooks"
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

app.use("/api/*", async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const status = c.res.status;
  if (!shouldAudit({ method, path, status })) return;
  const organizationId = c.get("organizationId");
  if (!organizationId) return;
  try {
    let body: unknown = null;
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("application/json") && method !== "GET") {
      body = await c.req.json().catch(() => null);
    }
    let responseBody: unknown = null;
    const responseType = c.res.headers.get("content-type") || "";
    if (responseType.includes("application/json")) {
      responseBody = await c.res.clone().json().catch(() => null);
    }
    const code = codeFromBody(responseBody);
    const actor = c.get("user");
    await c.get("db").insert(schema.auditEvents).values({
      id: newId(),
      organizationId,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? "",
      actorName: actor?.name ?? "",
      action: auditAction(method, status),
      method,
      path,
      status,
      code,
      summary: auditSummary({ method, path, status, code }),
      payloadJson: serializeAuditPayload(body),
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("audit write failed", err);
  }
});

app.route("/api", meRoute);
app.route("/api", organizationRoute);
app.route("/api", mediaRoute);
app.route("/api", catalogRoute);
app.route("/api", receiptsRoute);
app.route("/api", purchasesRoute);
app.route("/api", ordersRoute);
app.route("/api", returnsRoute);
app.route("/api", adjustmentsRoute);
app.route("/api", manufacturingRoute);
app.route("/api", shopifyRoute);
app.route("/api", floorRoute);
app.route("/api", searchRoute);
app.route("/api", teamRoute);
app.route("/api", layoutRoute);
app.route("/api", replenishmentsRoute);
app.route("/api", kitsRoute);
app.route("/api", holdsRoute);
app.route("/api", vendorReturnsRoute);
app.route("/api", jobsRoute);
app.route("/api", carriersRoute);
app.route("/api", wavesRoute);
app.route("/api", asnsRoute);
app.route("/api", zonesRoute);
app.route("/api", clientsRoute);
app.route("/api", yardRoute);
app.route("/api", laborRoute);
app.route("/api", printersRoute);
app.route("/api", billingRoute);
app.route("/api", ediRoute);
app.route("/api", equipmentRoute);
app.route("/api", analyticsRoute);
app.route("/api", auditRoute);
app.route("/api", liveRoute);

export default app;