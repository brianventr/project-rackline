import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { DrizzleQueryError } from "drizzle-orm";
import { errorRef, mapConstraintError, mapDomainError, respondToError } from "./error-response";
import { badRequest, conflict, forbidden, HttpError } from "./http";
import { WorkflowPolicyError } from "../domain/workflow-policy";
import { ClientStockError } from "../domain/client-stock";
import { requireOwner } from "./org";
import { AddressInvalidError } from "../domain/address-check";
import { CustomsRequiredError } from "../domain/customs";
import { HeldStockError } from "../domain/holds";
import { InsufficientAtpError } from "../domain/allocations";
import { InsufficientStockError } from "../domain/inventory";
import { JobVerbDeniedError } from "../domain/jobs";
import { CapacityInputError, LocationFullError } from "../domain/capacity";
import { PlateInputError, PlateOverLooseError, PlateShortError, PlateStateError } from "../domain/license-plates";

type Env = { Variables: { role?: "owner" | "operator"; organizationId?: string } };

function createApp(vars?: { role?: "owner" | "operator"; organizationId?: string }) {
  const app = new Hono<Env>();
  app.onError((err, c) => {
    const mapped = mapDomainError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    return c.json({ error: "Internal error" }, 500);
  });
  app.use("*", async (c, next) => {
    if (vars?.role) c.set("role", vars.role);
    if (vars?.organizationId) c.set("organizationId", vars.organizationId);
    await next();
  });
  app.post("/adjustments", (c) => {
    requireOwner(c.get("role"));
    return c.json({ ok: true });
  });
  app.post("/pick", (c) => {
    const org = c.get("organizationId");
    const itemOrg = c.req.query("itemOrg");
    if (!org || itemOrg !== org) throw new HttpError(404, "Item not found");
    throw new InsufficientAtpError("LED-BULB", 0, 2, "A-01-01");
  });
  app.get("/audit", (c) => {
    requireOwner(c.get("role"));
    return c.json([]);
  });
  return app;
}

describe("409 contract", () => {
  it("maps ATP, hold, and stock shortages with a code", () => {
    expect(mapDomainError(new InsufficientAtpError("LED-BULB", 1, 4, "A-01-02"))).toMatchObject({
      status: 409,
      body: { code: "INSUFFICIENT_ATP", sku: "LED-BULB", atp: 1, needed: 4, locationCode: "A-01-02" },
    });
    expect(mapDomainError(new HeldStockError("SHADE", "DOCK", "HLD-9", "Damaged"))).toMatchObject({
      status: 409,
      body: { code: "HELD_STOCK", sku: "SHADE", locationCode: "DOCK", holdNumber: "HLD-9" },
    });
    expect(mapDomainError(new InsufficientStockError("BASE", 0, 3))?.body).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      onHand: 0,
      needed: 3,
    });
  });

  it("says whose stock fell short only when ownership is the reason", () => {
    expect(mapDomainError(new InsufficientAtpError("LAMP", 0, 2))?.body).not.toHaveProperty("clientId");
    expect(mapDomainError(new InsufficientAtpError("LAMP", 0, 2, undefined, "c1"))?.body).toMatchObject({ clientId: "c1" });
    expect(mapDomainError(new InsufficientAtpError("LAMP", 0, 2, undefined, null))?.body).toMatchObject({ clientId: null });
    expect(mapDomainError(new ClientStockError(null, "i1", 1, 3))).toMatchObject({
      status: 409,
      body: { code: "CLIENT_STOCK", clientId: null, onHand: 1, needed: 3 },
    });
  });

  it("maps a full bay with its limit, and bad capacity input as a 400", () => {
    expect(mapDomainError(new LocationFullError("A-01-02", { measure: "qty", limit: 60, before: 50, after: 72 }))).toEqual({
      status: 409,
      body: {
        error: "A-01-02 would hold 72 units, over its limit of 60 units. Put the rest in another bay, or an owner can override.",
        code: "LOCATION_FULL",
        locationCode: "A-01-02",
        measure: "qty",
        limit: 60,
        before: 50,
        wouldBe: 72,
      },
    });
    expect(mapDomainError(new CapacityInputError("Max units must be a whole number, 0 or more"))).toEqual({
      status: 400,
      body: { error: "Max units must be a whole number, 0 or more" },
    });
  });

  it("maps license plate refusals with what the plate and bay hold", () => {
    expect(mapDomainError(new PlateStateError("LP-000123", "closed", "build"))).toEqual({
      status: 409,
      body: {
        error: "LP-000123 is closed. Reopen it to add stock.",
        code: "PLATE_STATUS",
        plateCode: "LP-000123",
        plateStatus: "closed",
        action: "build",
      },
    });
    expect(mapDomainError(new PlateOverLooseError("LP-000123", "SHADE", "A-01-01", 20, 4, 6))).toEqual({
      status: 409,
      body: {
        error: "Only 4 SHADE at A-01-01 are loose, and this needs 6. The rest is already on plates, so add 4 or fewer.",
        code: "PLATE_OVER_LOOSE",
        plateCode: "LP-000123",
        sku: "SHADE",
        locationCode: "A-01-01",
        onHand: 20,
        loose: 4,
        qty: 6,
        lotCode: null,
        expired: 0,
      },
    });
    expect(mapDomainError(new PlateShortError("LP-000123", "SHADE", 3, 5))).toMatchObject({
      status: 409,
      body: { code: "PLATE_SHORT", plateCode: "LP-000123", sku: "SHADE", onPlate: 3, needed: 5, serial: null },
    });
    expect(mapDomainError(new PlateInputError("Plate type must be tote, pallet, or carton."))).toEqual({
      status: 400,
      body: { error: "Plate type must be tote, pallet, or carton." },
    });
  });

  it("keeps HttpError codes and owner-only 403s", () => {
    expect(mapDomainError(new HttpError(409, "Set mail first", "MAIL_UNAVAILABLE"))).toEqual({
      status: 409,
      body: { error: "Set mail first", code: "MAIL_UNAVAILABLE" },
    });
    expect(mapDomainError(new JobVerbDeniedError("pick"))).toMatchObject({
      status: 403,
      body: { code: "JOB_VERB_DENIED", verb: "pick" },
    });
    try {
      conflict("Bay is full", "BAY_FULL");
    } catch (err) {
      expect(mapDomainError(err)?.body).toEqual({ error: "Bay is full", code: "BAY_FULL" });
    }
    try {
      forbidden("Owner role required");
    } catch (err) {
      expect(mapDomainError(err)).toEqual({ status: 403, body: { error: "Owner role required" } });
    }
  });

  it("maps the holds on a label: customs gaps by item, and the ship-to address with the carrier's suggestion", () => {
    const gaps = [{ sku: "SHADE", itemId: "item-1", missing: ["hsCode" as const] }];
    expect(mapDomainError(new CustomsRequiredError(gaps))).toMatchObject({
      status: 409,
      body: { code: "CUSTOMS_REQUIRED", sku: "SHADE", items: gaps },
    });
    const suggestion = { street1: "14 DOCK ST", street2: "", city: "PORTLAND", region: "OR", postal: "97209-1234", country: "US" };
    expect(mapDomainError(new AddressInvalidError({ message: "The ship-to address has no ZIP code.", suggestion }))).toEqual({
      status: 409,
      body: { error: "The ship-to address has no ZIP code.", code: "ADDRESS_INVALID", suggestion: "14 DOCK ST, PORTLAND, OR 97209-1234, US" },
    });
  });
});

describe("route guards", () => {
  it("forbids an operator from posting an adjustment or reading audit", async () => {
    const denied = await createApp({ role: "operator" }).request("http://localhost/adjustments", {
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Owner role required" });

    const audit = await createApp({ role: "operator" }).request("http://localhost/audit");
    expect(audit.status).toBe(403);
    expect(await audit.json()).toEqual({ error: "Owner role required" });
  });

  it("lets an owner adjust and 404s another org's SKU", async () => {
    const app = createApp({ role: "owner", organizationId: "org-a" });
    const ok = await app.request("http://localhost/adjustments", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const foreign = await app.request("http://localhost/pick?itemOrg=org-b", { method: "POST" });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Item not found" });

    const own = await app.request("http://localhost/pick?itemOrg=org-a", { method: "POST" });
    expect(own.status).toBe(409);
    expect(await own.json()).toMatchObject({ code: "INSUFFICIENT_ATP", sku: "LED-BULB" });
  });
});

const UNIQUE_SKU = "D1_ERROR: UNIQUE constraint failed: items.organization_id, items.sku: SQLITE_CONSTRAINT";
const UNIQUE_RECEIPT = "D1_ERROR: UNIQUE constraint failed: tracker_webhook_receipts.organization_id, tracker_webhook_receipts.event_id";
const FOREIGN_KEY = "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT";

function failedQuery(query: string, cause: string) {
  return new DrizzleQueryError(query, ["org-1", "LAMP", "sk_live_secret"], new Error(cause));
}

describe("database errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a unique failure to CONFLICT, naming only a known field", () => {
    expect(mapConstraintError(failedQuery('insert into "items" ("sku") values (?)', UNIQUE_SKU))).toEqual({
      status: 409,
      body: { error: "That SKU is already taken.", code: "CONFLICT", field: "SKU" },
    });
    expect(mapConstraintError(failedQuery("insert into tracker_webhook_receipts", UNIQUE_RECEIPT))).toEqual({
      status: 409,
      body: { error: "That already exists.", code: "CONFLICT" },
    });
  });

  it("maps a foreign key failure to IN_USE on delete and BAD_REFERENCE otherwise", () => {
    expect(mapConstraintError(failedQuery('delete from "locations" where "id" = ?', FOREIGN_KEY))).toEqual({
      status: 409,
      body: { error: "That is still in use, so it cannot be removed.", code: "IN_USE" },
    });
    expect(mapConstraintError(failedQuery('insert into "movements" ("location_id") values (?)', FOREIGN_KEY))).toMatchObject({
      status: 400,
      body: { code: "BAD_REFERENCE" },
    });
    expect(mapConstraintError(new Error(FOREIGN_KEY))).toMatchObject({ status: 400, body: { code: "BAD_REFERENCE" } });
  });

  it("turns anything else into INTERNAL with a reference, logged beside the full error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = failedQuery('update "orders" set "status" = ?', "D1_ERROR: NOT NULL constraint failed: orders.status");
    const out = respondToError(err, "POST /api/orders", "7KQ2M9XA");
    expect(out).toEqual({ status: 500, body: { error: "Something went wrong on our side.", code: "INTERNAL", ref: "7KQ2M9XA" } });
    expect(log).toHaveBeenCalledWith("Error 7KQ2M9XA on POST /api/orders", err, err.cause);
  });

  it("keeps typed errors and their codes as they were", () => {
    expect(respondToError(new WorkflowPolicyError("Scan the bay first.", "SCAN_REQUIRED"), "POST /x")).toEqual({
      status: 409,
      body: { error: "Scan the bay first.", code: "SCAN_REQUIRED" },
    });
    expect(respondToError(new HttpError(409, "Set mail first", "MAIL_UNAVAILABLE"), "POST /x").body).toEqual({
      error: "Set mail first",
      code: "MAIL_UNAVAILABLE",
    });
  });

  it("does not pass D1 text through an HttpError a route built from it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let thrown: unknown;
    try {
      badRequest(UNIQUE_SKU);
    } catch (err) {
      thrown = err;
    }
    expect(respondToError(thrown, "POST /x")).toEqual({
      status: 409,
      body: { error: "That SKU is already taken.", code: "CONFLICT", field: "SKU" },
    });
  });

  it("makes short references from an unambiguous alphabet", () => {
    const refs = new Set(Array.from({ length: 50 }, () => errorRef()));
    for (const ref of refs) expect(ref).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(refs.size).toBeGreaterThan(45);
  });

  it("never sends SQL, table names, or bound values to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new Hono();
    app.onError((err, c) => {
      const { status, body } = respondToError(err, `${c.req.method} ${new URL(c.req.url).pathname}`);
      return c.json(body, status);
    });
    app.post("/items", () => {
      throw failedQuery('insert into "items" ("id", "organization_id", "sku") values (?, ?, ?)', UNIQUE_SKU);
    });
    app.post("/crash", () => {
      throw failedQuery('select "api_key" from "carrier_connections"', "D1_ERROR: no such column: api_key: SQLITE_ERROR");
    });

    const duplicate = await app.request("http://localhost/items", { method: "POST" });
    expect(duplicate.status).toBe(409);
    const duplicateText = await duplicate.text();
    expect(JSON.parse(duplicateText)).toEqual({ error: "That SKU is already taken.", code: "CONFLICT", field: "SKU" });

    const crash = await app.request("http://localhost/crash", { method: "POST" });
    expect(crash.status).toBe(500);
    const crashText = await crash.text();
    expect(JSON.parse(crashText)).toMatchObject({ code: "INTERNAL", error: "Something went wrong on our side." });
    for (const text of [duplicateText, crashText]) {
      expect(text).not.toMatch(/insert|select|items\.|carrier_connections|D1_ERROR|SQLITE|sk_live_secret|org-1/i);
    }
  });
});
