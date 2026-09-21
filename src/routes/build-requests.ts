import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { cancelBuildRequest, listBuildRequests, releaseBuildRequest } from "../db/build-requests";

export const buildRequestsRoute = new Hono<AppEnv>();

buildRequestsRoute.get("/build-requests", async (c) => {
  const status = c.req.query("status")?.trim() || undefined;
  return c.json(await listBuildRequests(c.get("db"), c.get("organizationId")!, { status }));
});

buildRequestsRoute.post("/build-requests/:id/release", async (c) => {
  requireOwner(c.get("role"));
  return c.json(await releaseBuildRequest(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

buildRequestsRoute.post("/build-requests/:id/cancel", async (c) => {
  requireOwner(c.get("role"));
  return c.json(await cancelBuildRequest(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});
