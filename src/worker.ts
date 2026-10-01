import { Hono } from "hono";
import type { Context } from "hono";
import { createDb } from "./db/client";
import { createAuth } from "./lib/auth";
import { getMembership } from "./lib/org";
import { respondToError } from "./lib/error-response";
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
import { billingRoute, billingPublicRoute } from "./routes/billing";
import { trackingPublicRoute, trackingRoute } from "./routes/tracking";
import { returnLabelsPublicRoute, returnLabelsRoute } from "./routes/return-labels";
import { customsRoute } from "./routes/customs";
import { orderAddressRoute } from "./routes/order-address";
import { customerMailRoute } from "./routes/customer-mail";
import { ediRoute } from "./routes/edi";
import { equipmentRoute } from "./routes/equipment";
import { analyticsRoute } from "./routes/analytics";
import { mediaRoute } from "./routes/media";
import { auditRoute } from "./routes/audit";
import { liveRoute } from "./routes/live";
import { onboardingRoute } from "./routes/onboarding";
import { importsRoute } from "./routes/imports";
import { accountingRoute } from "./routes/accounting";
import { channelsPublicRoute, channelsRoute } from "./routes/channels";
import { runChannelCron } from "./db/channel-sync";
import { planAllCycleCounts } from "./db/cycle-plan";
import { recallRoute } from "./routes/recall";
import { scheduleRoute } from "./routes/schedule";
import { shipRoute } from "./routes/ship";
import { vendorsRoute } from "./routes/vendors";
import { customersRoute } from "./routes/customers";
import { platesRoute } from "./routes/plates";
import { exceptionsRoute } from "./routes/exceptions";
import { marketingPageByPath } from "./domain/marketing-pages";
import { injectMarketingMeta, robotsTxt, sitemapXml } from "./domain/marketing-seo";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  const { status, body } = respondToError(err, `${c.req.method} ${new URL(c.req.url).pathname}`);
  return c.json(body, status);
});

/** Crawlable sitemap / robots (Worker-first; not SPA). */
app.get("/sitemap.xml", (c) => {
  const origin = originFrom(c.req.url);
  return c.body(sitemapXml(origin), 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/robots.txt", (c) => {
  const origin = originFrom(c.req.url);
  return c.text(robotsTxt(origin), 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

/** Marketing LPs: inject title/description into SPA index for crawlers. */
app.get("/industries/:slug", (c) => serveMarketingHtml(c));
app.get("/use-cases/:slug", (c) => serveMarketingHtml(c));
app.get("/compare/:slug", (c) => serveMarketingHtml(c));

async function serveMarketingHtml(c: Context<AppEnv>) {
  const url = new URL(c.req.url);
  const page = marketingPageByPath(url.pathname);
  const origin = originFrom(c.req.url);
  const assets = c.env.ASSETS;
  if (!assets) {
    return c.text("Assets binding unavailable", 500);
  }
  if (!page) {
    return assets.fetch(c.req.raw);
  }
  const indexRes = await assets.fetch(new Request(new URL("/index.html", url.origin), c.req.raw));
  const html = injectMarketingMeta(await indexRes.text(), page, origin);
  return c.html(html);
}

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
app.route("/api", billingPublicRoute);
app.route("/api", channelsPublicRoute);
app.route("/api", trackingPublicRoute);
app.route("/api", returnLabelsPublicRoute);

app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/api/auth") ||
    path === "/api/register" ||
    path === "/api/demo/seed" ||
    path === "/api/shopify/webhooks" ||
    path === "/api/shopify/fulfillment_order_notification" ||
    path === "/api/shopify/oauth/callback" ||
    path === "/api/carriers/trackers/webhooks" ||
    path.startsWith("/api/carriers/trackers/webhooks/") ||
    path.startsWith("/api/channels/woocommerce/webhook/") ||
    path === "/api/channels/etsy/oauth/callback" ||
    path.startsWith("/api/billing/portal/") ||
    path.startsWith("/api/track/") ||
    path.startsWith("/api/return-label/")
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
app.route("/api", shipRoute);
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
app.route("/api", trackingRoute);
app.route("/api", returnLabelsRoute);
app.route("/api", customsRoute);
app.route("/api", orderAddressRoute);
app.route("/api", customerMailRoute);
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
app.route("/api", onboardingRoute);
app.route("/api", importsRoute);
app.route("/api", accountingRoute);
app.route("/api", channelsRoute);
app.route("/api", recallRoute);
app.route("/api", scheduleRoute);
app.route("/api", vendorsRoute);
app.route("/api", customersRoute);
app.route("/api", platesRoute);
app.route("/api", exceptionsRoute);

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const db = createDb(env.DB);
        try {
          await runChannelCron(db, env);
        } catch (err) {
          console.error("channel cron failed", err);
        }
        await planAllCycleCounts(db);
      })(),
    );
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;