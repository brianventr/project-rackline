export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export class ImageUrlError extends Error {
  constructor(message = "Invalid image URL") {
    super(message);
    this.name = "ImageUrlError";
  }
}

export function normalizeImageUrl(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ImageUrlError("imageUrl must be a string");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/demo-sku/")) {
    if (trimmed.includes("..") || trimmed.includes("//")) throw new ImageUrlError();
    if (!/^\/demo-sku\/[A-Za-z0-9._-]+$/.test(trimmed)) throw new ImageUrlError();
    return trimmed;
  }
  if (trimmed.startsWith("/api/media/")) {
    const key = trimmed.slice("/api/media/".length);
    if (!key || key.includes("..") || key.startsWith("/") || key.includes("//")) throw new ImageUrlError();
    if (!/^org\/[A-Za-z0-9_-]+\/(items|boms)\/[A-Za-z0-9/_-]+$/.test(key)) throw new ImageUrlError();
    return `/api/media/${key}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ImageUrlError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ImageUrlError();
  return parsed.toString();
}

export function copyIfEmptyImageUrl(
  current: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const existing = typeof current === "string" && current.trim() ? current.trim() : null;
  if (existing) return existing;
  try {
    return normalizeImageUrl(incoming ?? null);
  } catch {
    return null;
  }
}

export function mediaItemKey(organizationId: string, itemId: string): string {
  return `org/${organizationId}/items/${itemId}`;
}

export function mediaStepKey(organizationId: string, bomId: string, stepId: string): string {
  return `org/${organizationId}/boms/${bomId}/steps/${stepId}`;
}

export function mediaPublicPath(key: string): string {
  return `/api/media/${key}`;
}

export function mediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url?.startsWith("/api/media/")) return null;
  return url.slice("/api/media/".length) || null;
}

export function mediaKeyOwnedByOrg(key: string, organizationId: string): boolean {
  return key.startsWith(`org/${organizationId}/`);
}
