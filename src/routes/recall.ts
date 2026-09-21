import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { holdRecallRemainder, loadRecall } from "../db/recall";

export const recallRoute = new Hono<AppEnv>();

recallRoute.get("/recall", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) badRequest("Lot or serial is required");
  return c.json(await loadRecall(c.get("db"), c.get("organizationId")!, query));
});

recallRoute.post("/recall/hold", async (c) => {
  const body = await c.req.json<{ q?: string }>();
  return c.json(await holdRecallRemainder(c.get("db"), c.get("organizationId")!, body.q ?? ""));
});
