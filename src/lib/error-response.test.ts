import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mapDomainError } from "./error-response";
import { conflict, forbidden, HttpError } from "./http";
import { requireOwner } from "./org";
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
