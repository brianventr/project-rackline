import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { requireOwner } from "../lib/org";
import { loadLiveDay } from "../db/live";

export const liveRoute = new Hono<AppEnv>();

liveRoute.get("/live", async (c) => {
  requireOwner(c.get("role"));
  const warehouseId = c.req.query("warehouseId");
  if (!warehouseId) badRequest("warehouseId is required");
  const day = await loadLiveDay(c.get("db"), c.get("organizationId")!, warehouseId, Date.now());
  return c.json(day);
});
