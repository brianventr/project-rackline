import { ApiError, api } from "@/app/api";
import type { LabModel, LabModelStats } from "@/domain/cad-lab";

export function listLabModels(): Promise<{ models: LabModel[] }> {
  return api<{ models: LabModel[] }>("/api/lab/cad");
}

/** GLBs stay cached for the session: switching between models should not download them again. */
const glbCache = new Map<string, Promise<ArrayBuffer>>();

export function rememberGlb(slug: string, glb: ArrayBuffer) {
  glbCache.set(slug, Promise.resolve(glb));
}

export function forgetGlb(slug: string) {
  glbCache.delete(slug);
}

export function fetchLabGlb(slug: string): Promise<ArrayBuffer> {
  let pending = glbCache.get(slug);
  if (!pending) {
    pending = fetch(`/api/lab/cad/${encodeURIComponent(slug)}`, { credentials: "include" }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError((body as { error?: string }).error ?? res.statusText, res.status, body);
      }
      return res.arrayBuffer();
    });
    pending.catch(() => glbCache.delete(slug));
    glbCache.set(slug, pending);
  }
  return pending;
}

export async function saveLabModel(slug: string, glb: ArrayBuffer, stats: LabModelStats): Promise<LabModel> {
  const body = new FormData();
  body.append("file", new Blob([glb], { type: "model/gltf-binary" }), `${slug}.glb`);
  body.append("meta", JSON.stringify(stats));
  const res = await fetch(`/api/lab/cad/${encodeURIComponent(slug)}`, { method: "PUT", body, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status, data);
  return (data as { model: LabModel }).model;
}

export function deleteLabModel(slug: string): Promise<{ ok: true }> {
  forgetGlb(slug);
  return api<{ ok: true }>(`/api/lab/cad/${encodeURIComponent(slug)}`, { method: "DELETE" });
}
