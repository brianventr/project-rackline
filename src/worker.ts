import { Hono } from "hono";
import { createDb } from "./db/client";
import { createAuth } from "./lib/auth";
import { getMembership } from "./lib/org";
import { HttpError } from "./lib/http";
import { InsufficientStockError } from "./domain/inventory";
import { OverReceiveError, OverUnreceiveError } from "./domain/partial-receive";
import { OverPickError } from "./domain/partial-pick";
import { OverPackError } from "./domain/partial-pack";
import { OverCartonError } from "./domain/cartons";
import { OverMoveError } from "./domain/partial-transfer";
import { OverReturnError } from "./domain/partial-rtv";
import { OverCompleteError } from "./domain/partial-complete";
import { OverUnpickError } from "./domain/partial-unpick";
import { OverBatchPickError } from "./domain/waves";
import { HeldStockError } from "./domain/holds";
import { ExpiredLotError } from "./domain/expiry";
import { InsufficientAtpError } from "./domain/allocations";
import { ClientStockError } from "./domain/client-stock";
import { JobClaimedError, JobNotReadyError, JobVerbDeniedError } from "./domain/jobs";
import { EquipmentCustodyError } from "./domain/equipment";
import { CarrierLiveError } from "./domain/carrier-live";
import { originFrom, type AppEnv } from "./lib/types";
import { registerRoute } from "./routes/register";
import { demoRoute } from "./routes/demo";
import { meRoute } from "./routes/me";
import { catalogRoute } from "./routes/catalog";
import { receiptsRoute } from "./routes/receipts";
import { purchasesRoute } from "./routes/purchases";
import { ordersRoute } from "./routes/orders";
import { returnsRoute } from "./routes/returns";
import { adjustmentsRoute } from "./routes/adjustments";
import { manufacturingRoute } from "./routes/manufacturing";
import { shopifyPublicRoute, shopifyRoute } from "./routes/shopify";
import { ShopifyIngestError } from "./domain/shopify-ingest";
import { ImageUrlError } from "./domain/media";
import { BomStepError } from "./domain/bom-steps";
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
  if (err instanceof OverReceiveError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_RECEIVE",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverUnreceiveError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_UNRECEIVE",
        sku: err.sku,
        received: err.received,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverPickError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_PICK",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverPackError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_PACK",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverCartonError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_CARTON",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverMoveError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_MOVE",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverReturnError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_RETURN",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverCompleteError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_COMPLETE",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverUnpickError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_UNPICK",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof OverBatchPickError) {
    return c.json(
      {
        error: err.message,
        code: "OVER_BATCH_PICK",
        sku: err.sku,
        remaining: err.remaining,
        qty: err.qty,
      },
      409,
    );
  }
  if (err instanceof HeldStockError) {
    return c.json(
      {
        error: err.message,
        code: "HELD_STOCK",
        sku: err.sku,
        locationCode: err.locationCode,
        holdNumber: err.holdNumber,
        reason: err.reason,
      },
      409,
    );
  }
  if (err instanceof ExpiredLotError) {
    return c.json(
      {
        error: err.message,
        code: "EXPIRED_LOT",
        sku: err.sku,
        lotCode: err.lotCode ?? null,
        expiresOn: err.expiresOn ?? null,
      },
      400,
    );
  }
  if (err instanceof InsufficientAtpError) {
    return c.json(
      {
        error: err.message,
        code: "INSUFFICIENT_ATP",
        sku: err.sku,
        atp: err.atp,
        needed: err.needed,
        locationCode: err.locationCode,
      },
      409,
    );
  }
  if (err instanceof ClientStockError) {
    return c.json(
      {
        error: err.message,
        code: "CLIENT_STOCK",
        clientId: err.clientId,
        itemId: err.itemId,
        onHand: err.onHand,
        needed: err.needed,
      },
      409,
    );
  }
  if (err instanceof JobClaimedError) {
    return c.json(
      {
        error: err.message,
        code: "JOB_CLAIMED",
        claimedById: err.claimedById,
        claimedByName: err.claimedByName,
      },
      409,
    );
  }
  if (err instanceof EquipmentCustodyError) {
    return c.json(
      {
        error: err.message,
        code: err.code,
        ...err.extras,
      },
      409,
    );
  }
  if (err instanceof CarrierLiveError) {
    return c.json({ error: err.message, code: err.code }, 409);
  }
  if (err instanceof JobNotReadyError) {
    return c.json({ error: err.message, code: "JOB_NOT_READY", notBefore: err.notBefore }, 409);
  }
  if (err instanceof JobVerbDeniedError) {
    return c.json({ error: err.message, code: "JOB_VERB_DENIED", verb: err.verb }, 403);
  }
  if (err instanceof ShopifyIngestError) {
    return c.json({ error: err.message }, err.status as 400 | 409);
  }
  if (err instanceof ImageUrlError || err instanceof BomStepError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof HttpError) {
    return c.json(
      err.code ? { error: err.message, code: err.code } : { error: err.message },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
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

app.route("/api", meRoute);
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

export default app;
