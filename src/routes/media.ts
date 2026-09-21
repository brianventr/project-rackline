import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { conflict, forbidden, notFound } from "../lib/http";
import { mediaKeyOwnedByOrg } from "../domain/media";

export const mediaRoute = new Hono<AppEnv>();

mediaRoute.get("/media/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/media\//, ""));
  const organizationId = c.get("organizationId")!;
  if (!key || !mediaKeyOwnedByOrg(key, organizationId)) forbidden("Not your media");
  const bucket = c.env.MEDIA;
  if (!bucket) conflict("Media bucket is not configured", "MISSING_MEDIA");
  const object = await bucket.get(key);
  if (!object) notFound("Image not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
});
