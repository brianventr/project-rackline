import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mapDomainError } from "./error-response";
import { conflict, forbidden, HttpError } from "./http";
import { requireOwner } from "./org";
import { HeldStockError } from "../domain/holds";
import { InsufficientAtpError } from "../domain/allocations";
import { InsufficientStockError } from "../domain/inventory";
import { JobVerbDeniedError } from "../domain/jobs";

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
  it("forbids an operator from posting an adjustment", async () => {
    const denied = await createApp({ role: "operator" }).request("http://localhost/adjustments", {
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Owner role required" });
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
