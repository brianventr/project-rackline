import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { isFloorVerb } from "../domain/jobs";
import {
  assignFloorJob,
  claimFloorJob,
  getFloorJob,
  listFloorJobs,
  nextFloorJobs,
  patchFloorJob,
  pinFloorJob,
  releaseFloorJob,
} from "../db/jobs";

export const jobsRoute = new Hono<AppEnv>();

jobsRoute.get("/jobs/next", async (c) => {
  const jobs = await nextFloorJobs(c.get("db"), {
    organizationId: c.get("organizationId")!,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    warehouseId: c.req.query("warehouseId") || undefined,
    fromLocationId: c.req.query("fromLocationId") || undefined,
  });
  return c.json(jobs);
});

jobsRoute.get("/jobs", async (c) => {
  const verb = c.req.query("verb");
  if (verb && !isFloorVerb(verb)) badRequest("Unknown verb");
  const jobs = await listFloorJobs(c.get("db"), c.get("organizationId")!, {
    warehouseId: c.req.query("warehouseId") || undefined,
    verb: verb && isFloorVerb(verb) ? verb : undefined,
    assigneeId: c.req.query("assignee") || undefined,
    mine: c.req.query("mine") === "1" ? c.get("user")!.id : undefined,
    open: c.req.query("open") !== "0",
  });
  return c.json(jobs);
});

jobsRoute.get("/jobs/:id", async (c) => {
  return c.json(await getFloorJob(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

jobsRoute.post("/jobs/:id/claim", async (c) => {
  return c.json(
    await claimFloorJob(c.get("db"), {
      organizationId: c.get("organizationId")!,
      userId: c.get("user")!.id,
      role: c.get("role")!,
      jobId: c.req.param("id"),
    }),
  );
});

jobsRoute.post("/jobs/:id/release", async (c) => {
  return c.json(
    await releaseFloorJob(c.get("db"), {
      organizationId: c.get("organizationId")!,
      userId: c.get("user")!.id,
      role: c.get("role")!,
      jobId: c.req.param("id"),
    }),
  );
});

jobsRoute.post("/jobs/:id/assign", async (c) => {
  const body = await c.req.json<{ userId?: string | null }>().catch(() => ({}) as { userId?: string | null });
  return c.json(
    await assignFloorJob(c.get("db"), {
      organizationId: c.get("organizationId")!,
      actorId: c.get("user")!.id,
      role: c.get("role")!,
      jobId: c.req.param("id"),
      userId: body.userId ?? null,
    }),
  );
});

jobsRoute.post("/jobs/:id/pin", async (c) => {
  const body = await c.req.json<{ pinned?: boolean }>().catch(() => ({}) as { pinned?: boolean });
  return c.json(
    await pinFloorJob(c.get("db"), {
      organizationId: c.get("organizationId")!,
      role: c.get("role")!,
      jobId: c.req.param("id"),
      pinned: body.pinned !== false,
    }),
  );
});

jobsRoute.patch("/jobs/:id", async (c) => {
  const body = await c.req.json<{ notBefore?: number | null; dueAt?: number | null }>().catch(
    () => ({}) as { notBefore?: number | null; dueAt?: number | null },
  );
  return c.json(
    await patchFloorJob(c.get("db"), {
      organizationId: c.get("organizationId")!,
      role: c.get("role")!,
      jobId: c.req.param("id"),
      notBefore: body.notBefore,
      dueAt: body.dueAt,
    }),
  );
});
