import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest, requireString } from "../lib/http";
import { claimReplacement, flushOutbox, lookupWarranty } from "../db/warranty";

export const warrantyRoute = new Hono<AppEnv>();

warrantyRoute.get("/warranty/lookup", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  if (!query) badRequest("q is required");
  const matches = await lookupWarranty(c.get("db"), c.get("organizationId")!, query);
  return c.json({ query, matches });
});

warrantyRoute.post("/warranty/claims", async (c) => {
  const body = await c.req.json<{ serial?: string }>();
  const serial = requireString(body.serial, "serial");
  const claimed = await claimReplacement(c.get("db"), {
    organizationId: c.get("organizationId")!,
    serial,
  });
  return c.json(claimed, 201);
});

warrantyRoute.post("/warranty/outbox/flush", async (c) => {
  await flushOutbox(c.get("db"), c.get("organizationId")!, c.get("origin"));
  return c.json({ ok: true });
});
