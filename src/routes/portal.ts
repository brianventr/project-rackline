import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest, forbidden } from "../lib/http";
import { loadClientPortal } from "../db/portal";
import { createBuildRequest } from "../db/build-requests";

export const portalRoute = new Hono<AppEnv>();

function requirePortalClient(clientId: string | undefined): string {
  if (!clientId) forbidden("Client portal only");
  return clientId;
}

portalRoute.get("/portal", async (c) => {
  const clientId = requirePortalClient(c.get("clientId"));
  return c.json(await loadClientPortal(c.get("db"), c.get("organizationId")!, clientId));
});

portalRoute.post("/portal/requests", async (c) => {
  const clientId = requirePortalClient(c.get("clientId"));
  const body = await c.req.json<{ itemId?: string; qty?: number }>();
  const itemId = body.itemId?.trim() ?? "";
  if (!itemId) badRequest("Item is required");
  const created = await createBuildRequest(c.get("db"), c.get("organizationId")!, {
    clientId,
    itemId,
    qty: Number(body.qty),
  });
  return c.json(created, 201);
});
