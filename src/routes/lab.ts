import { Hono, type Context } from "hono";
import type { AppEnv } from "../lib/types";
import { badRequest, badRequestFrom, conflict, forbidden, notFound, unauthorized } from "../lib/http";
import { labAccessFor } from "../lib/lab-access";
import { LAB_CLOSED_MESSAGE, type LabAccess } from "../domain/lab-access";
import {
  LAB_MAX_MODEL_BYTES,
  encodeLabMeta,
  isGlb,
  isLabModelSlug,
  labModelKey,
  labModelPrefix,
  normalizeLabStats,
  parseLabMeta,
  slugFromLabKey,
  sortLabModels,
  type LabModel,
  type LabModelStats,
} from "../domain/cad-lab";

type AccessCheck = (c: Context<AppEnv>, organizationId: string) => Promise<LabAccess>;

function bucketFor(c: Context<AppEnv>): R2Bucket {
  const bucket = c.env.MEDIA;
  if (!bucket) conflict("Media bucket is not configured", "MISSING_MEDIA");
  return bucket;
}

function slugParam(c: Context<AppEnv>): string {
  const slug = c.req.param("slug") ?? "";
  if (!isLabModelSlug(slug)) notFound("Model not found");
  return slug;
}

/**
 * The hidden CAD lab's model library: GLBs the lab converted from STEP, kept per organization in the
 * MEDIA bucket under org/<id>/lab/cad/. Signed-in members only (the /api auth middleware runs first, and
 * this route refuses a request it did not authenticate), never the shared demo organization, and only
 * the organizations in LAB_ORG_IDS when that is set. Product CAD never sits in a public path or the repo.
 */
export function createLabRoute(access: AccessCheck = (c, organizationId) => labAccessFor(c.get("db"), c.env, organizationId)) {
  const route = new Hono<AppEnv>();

  route.use("/lab/*", async (c, next) => {
    const organizationId = c.get("organizationId");
    if (!organizationId) unauthorized();
    const verdict = await access(c, organizationId);
    if (verdict !== "open") forbidden(LAB_CLOSED_MESSAGE[verdict]);
    await next();
  });

  route.get("/lab/cad", async (c) => {
    const organizationId = c.get("organizationId")!;
    const bucket = bucketFor(c);
    const models: LabModel[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: labModelPrefix(organizationId), cursor, include: ["customMetadata"] });
      for (const object of page.objects) {
        const slug = slugFromLabKey(organizationId, object.key);
        if (!slug) continue;
        models.push({ slug, bytes: object.size, ...parseLabMeta(object.customMetadata, slug) });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return c.json({ models: sortLabModels(models) });
  });

  route.get("/lab/cad/:slug", async (c) => {
    const organizationId = c.get("organizationId")!;
    const slug = slugParam(c);
    const bucket = bucketFor(c);
    // Only If-None-Match goes to R2, so a failed condition always means "your copy is current" (304).
    const ifNoneMatch = c.req.header("if-none-match");
    const object = await bucket.get(
      labModelKey(organizationId, slug),
      ifNoneMatch ? { onlyIf: new Headers({ "If-None-Match": ifNoneMatch }) } : undefined,
    );
    if (!object) notFound("Model not found");
    const headers = new Headers({
      "Content-Type": "model/gltf-binary",
      ETag: object.httpEtag,
      "Cache-Control": "private, no-cache",
    });
    if (!("body" in object)) return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers });
  });

  route.put("/lab/cad/:slug", async (c) => {
    const organizationId = c.get("organizationId")!;
    const user = c.get("user");
    const slug = slugParam(c);
    const bucket = bucketFor(c);
    const limitMb = Math.round(LAB_MAX_MODEL_BYTES / 1024 / 1024);
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > LAB_MAX_MODEL_BYTES + 64 * 1024) badRequest(`A model must be ${limitMb} MB or smaller`);
    if (!(c.req.header("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
      badRequest("Upload the model as multipart form data with file and meta");
    }

    const form = await c.req.raw.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) badRequest("file is required");
    if (file.size > LAB_MAX_MODEL_BYTES) badRequest(`A model must be ${limitMb} MB or smaller`);
    // Check the header only; the File itself goes to R2, so a big model is not copied again in memory.
    if (!isGlb(new Uint8Array(await file.slice(0, 20).arrayBuffer()))) badRequest("The file is not a binary glTF (.glb) model");

    let stats: LabModelStats;
    try {
      const meta = form.get("meta");
      stats = normalizeLabStats(JSON.parse(typeof meta === "string" ? meta : "null"));
    } catch (err) {
      badRequestFrom(err instanceof SyntaxError ? new Error("meta must be JSON") : err, "meta is invalid");
    }

    const meta = { ...stats, uploadedBy: user?.email ?? "", uploadedAt: Date.now() };
    await bucket.put(labModelKey(organizationId, slug), file, {
      httpMetadata: { contentType: "model/gltf-binary" },
      customMetadata: encodeLabMeta(meta),
    });
    const model: LabModel = { slug, bytes: file.size, ...meta };
    return c.json({ model });
  });

  route.delete("/lab/cad/:slug", async (c) => {
    const organizationId = c.get("organizationId")!;
    const slug = slugParam(c);
    await bucketFor(c).delete(labModelKey(organizationId, slug));
    return c.json({ ok: true });
  });

  return route;
}

export const labRoute = createLabRoute();
