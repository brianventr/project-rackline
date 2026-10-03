import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/types";
import { respondToError } from "../lib/error-response";
import { LAB_MAX_MODEL_BYTES } from "../domain/cad-lab";
import type { LabAccess } from "../domain/lab-access";
import { createLabRoute } from "./lab";

/** Just enough of R2 for the library: list with paging and metadata, conditional get, put, delete. */
class MemoryBucket {
  objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; customMetadata: Record<string, string>; etag: string }>();
  pageSize = 2;
  private version = 0;

  async put(key: string, value: Uint8Array<ArrayBuffer> | Blob, options: { customMetadata?: Record<string, string> }) {
    const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
    this.objects.set(key, { bytes, customMetadata: options.customMetadata ?? {}, etag: `v${++this.version}` });
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(options: { prefix: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const slice = keys.slice(start, start + this.pageSize);
    const truncated = start + this.pageSize < keys.length;
    return {
      objects: slice.map((key) => ({ key, size: this.objects.get(key)!.bytes.byteLength, customMetadata: this.objects.get(key)!.customMetadata })),
      truncated,
      cursor: truncated ? String(start + this.pageSize) : undefined,
    };
  }

  async get(key: string, options?: { onlyIf?: Headers }) {
    const object = this.objects.get(key);
    if (!object) return null;
    const meta = { key, size: object.bytes.byteLength, httpEtag: `"${object.etag}"` };
    if (options?.onlyIf?.get("if-none-match") === meta.httpEtag) return meta;
    return { ...meta, body: new Blob([object.bytes]).stream() };
  }
}

function glb(extra = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(20 + extra);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  return bytes;
}

const META = { name: "AX-1000", parts: 40, triangles: 120000, sizeMm: [300, 110.4, 900], sourceName: "AX-1000.stp", sourceBytes: 2000000 };

function setup(
  organizationId: string | null = "org_1",
  bucket: MemoryBucket | null = new MemoryBucket(),
  access: LabAccess = "open",
) {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => {
    const { status, body } = respondToError(err, "test");
    return c.json(body, status);
  });
  app.use("*", async (c, next) => {
    if (organizationId) {
      c.set("organizationId", organizationId);
      c.set("user", { id: "u1", name: "Avery", email: "avery@example.com" });
    }
    await next();
  });
  app.route("/api", createLabRoute(async () => access));
  const env = { MEDIA: bucket ?? undefined } as unknown as AppEnv["Bindings"];
  return { bucket, request: (path: string, init?: RequestInit) => app.request(path, init, env) };
}

function upload(file: Blob | null, meta: unknown = META) {
  const body = new FormData();
  if (file) body.append("file", file, "model.glb");
  body.append("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
  return { method: "PUT", body };
}

describe("lab CAD library", () => {
  it("stores a model under the organization and lists it with its stats", async () => {
    const { bucket, request } = setup();
    const put = await request("/api/lab/cad/ax-1000", upload(new Blob([glb(100)])));
    expect(put.status).toBe(200);
    const { model } = (await put.json()) as { model: Record<string, unknown> };
    expect(model).toMatchObject({ slug: "ax-1000", bytes: 120, name: "AX-1000", parts: 40, uploadedBy: "avery@example.com" });
    expect([...bucket!.objects.keys()]).toEqual(["org/org_1/lab/cad/ax-1000.glb"]);

    const list = await request("/api/lab/cad");
    const body = (await list.json()) as { models: { slug: string; triangles: number }[] };
    expect(body.models.map((m) => [m.slug, m.triangles])).toEqual([["ax-1000", 120000]]);
  });

  it("pages through the whole library and sorts it", async () => {
    const { request } = setup();
    for (const [slug, name] of [
      ["ax-800", "AX-800"],
      ["bx-cup-holder", "BX Cup Holder"],
      ["bench-clamp", "Bench Clamp"],
      ["ax-1200", "AX-1200"],
      ["bx-pen-tray", "BX Pen Tray"],
    ]) {
      expect((await request(`/api/lab/cad/${slug}`, upload(new Blob([glb()]), { ...META, name }))).status).toBe(200);
    }
    const body = (await (await request("/api/lab/cad")).json()) as { models: { name: string }[] };
    expect(body.models.map((m) => m.name)).toEqual(["AX-800", "AX-1200", "BX Cup Holder", "BX Pen Tray", "Bench Clamp"]);
  });

  it("keeps organizations apart", async () => {
    const shared = new MemoryBucket();
    await setup("org_1", shared).request("/api/lab/cad/ax-1000", upload(new Blob([glb()])));
    const other = setup("org_2", shared);
    const list = (await (await other.request("/api/lab/cad")).json()) as { models: unknown[] };
    expect(list.models).toEqual([]);
    expect((await other.request("/api/lab/cad/ax-1000")).status).toBe(404);
  });

  it("serves the GLB and answers a matching ETag with 304", async () => {
    const { request } = setup();
    await request("/api/lab/cad/ax-1000", upload(new Blob([glb(12)])));
    const res = await request("/api/lab/cad/ax-1000");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(32);
    const etag = res.headers.get("etag")!;
    const again = await request("/api/lab/cad/ax-1000", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });

  it("refuses odd slugs, non-GLB files, and bad stats", async () => {
    const { request } = setup();
    expect((await request("/api/lab/cad/..%2Fsecret")).status).toBe(404);
    expect((await request("/api/lab/cad/AX-1000", upload(new Blob([glb()])))).status).toBe(404);
    const notGlb = await request("/api/lab/cad/ax-1000", upload(new Blob(["ISO-10303-21;"])));
    expect(notGlb.status).toBe(400);
    expect(((await notGlb.json()) as { error: string }).error).toContain("binary glTF");
    expect((await request("/api/lab/cad/ax-1000", upload(null))).status).toBe(400);
    const badMeta = await request("/api/lab/cad/ax-1000", upload(new Blob([glb()]), "{nope"));
    expect(((await badMeta.json()) as { error: string }).error).toBe("meta must be JSON");
    const noName = await request("/api/lab/cad/ax-1000", upload(new Blob([glb()]), { ...META, name: "" }));
    expect(((await noName.json()) as { error: string }).error).toBe("name is required");
    const json = await request("/api/lab/cad/ax-1000", { method: "PUT", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(json.status).toBe(400);
  });

  it("deletes a model", async () => {
    const { bucket, request } = setup();
    await request("/api/lab/cad/ax-1000", upload(new Blob([glb()])));
    expect((await request("/api/lab/cad/ax-1000", { method: "DELETE" })).status).toBe(200);
    expect(bucket!.objects.size).toBe(0);
    expect((await request("/api/lab/cad/ax-1000")).status).toBe(404);
  });

  it("refuses requests the auth middleware did not sign in", async () => {
    const { request } = setup(null);
    expect((await request("/api/lab/cad")).status).toBe(401);
    expect((await request("/api/lab/cad/ax-1000")).status).toBe(401);
    expect((await request("/api/lab/cad/ax-1000", upload(new Blob([glb()])))).status).toBe(401);
    expect((await request("/api/lab/cad/ax-1000", { method: "DELETE" })).status).toBe(401);
  });

  it("stays closed to the demo organization and to organizations off the allow-list", async () => {
    const demo = setup("org_demo", new MemoryBucket(), "demo");
    const list = await demo.request("/api/lab/cad");
    expect(list.status).toBe(403);
    expect(((await list.json()) as { error: string }).error).toMatch(/demo/);
    expect((await demo.request("/api/lab/cad/ax-1000", upload(new Blob([glb()])))).status).toBe(403);
    expect(demo.bucket!.objects.size).toBe(0);
    const other = setup("org_2", new MemoryBucket(), "not-listed");
    expect((await other.request("/api/lab/cad")).status).toBe(403);
  });

  it("refuses a model over the size limit", async () => {
    const { request } = setup();
    const big = new Blob([glb(), new Uint8Array(LAB_MAX_MODEL_BYTES)]);
    const res = await request("/api/lab/cad/ax-1000", upload(big));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/40 MB or smaller/);
  });

  it("answers only If-None-Match with 304", async () => {
    const { request } = setup();
    await request("/api/lab/cad/ax-1000", upload(new Blob([glb(8)])));
    const res = await request("/api/lab/cad/ax-1000", { headers: { "If-Match": '"stale"' } });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(28);
  });

  it("says when the media bucket is missing", async () => {
    const { request } = setup("org_1", null);
    const res = await request("/api/lab/cad");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("MISSING_MEDIA");
  });
});
