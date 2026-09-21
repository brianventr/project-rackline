import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { forbidden } from "../lib/http";
import { loadClientPortal } from "../db/portal";

export const portalRoute = new Hono<AppEnv>();

portalRoute.get("/portal", async (c) => {
  const clientId = c.get("clientId");
  if (!clientId) forbidden("Client portal only");
  return c.json(await loadClientPortal(c.get("db"), c.get("organizationId")!, clientId));
});
