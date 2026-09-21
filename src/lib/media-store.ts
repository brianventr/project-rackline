import { badRequest, conflict } from "./http";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  mediaKeyFromUrl,
  mediaPublicPath,
} from "../domain/media";

export async function putMediaFile(
  bucket: R2Bucket | undefined,
  key: string,
  file: File,
): Promise<string> {
  if (!bucket) conflict("Media bucket is not configured", "MISSING_MEDIA");
  if (file.size <= 0) badRequest("file is required");
  if (file.size > MAX_MEDIA_BYTES) badRequest("Image must be 2MB or smaller");
  const type = file.type || "application/octet-stream";
  if (!ALLOWED_MEDIA_TYPES.has(type)) badRequest("Image must be jpeg, png, webp, or gif");
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  return mediaPublicPath(key);
}

export async function deleteManagedMedia(
  bucket: R2Bucket | undefined,
  url: string | null | undefined,
): Promise<void> {
  const key = mediaKeyFromUrl(url);
  if (!key || !bucket) return;
  await bucket.delete(key);
}

export async function readUploadedFile(request: Request, field = "file"): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    badRequest("Upload a multipart image file");
  }
  const form = await request.formData();
  const value = form.get(field);
  if (!(value instanceof File)) badRequest("file is required");
  return value;
}
