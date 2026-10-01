/** Bearer-key read API. Pages are capped at 50. Cursors are opaque and carry no internal ids. */

export const API_SCOPES = ["orders:read", "stock:read", "shipments:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_PAGE_SIZE = 50;

export function parseApiScopes(value: unknown): ApiScope[] {
  if (!Array.isArray(value)) throw new Error("Choose at least one scope");
  const scopes = [...new Set(value.filter((item): item is ApiScope => (API_SCOPES as readonly string[]).includes(String(item))))];
  if (scopes.length === 0 || scopes.length !== value.length) throw new Error("Scopes must be orders:read, stock:read, or shipments:read");
  return scopes;
}

export function storedScopes(value: string | null | undefined): ApiScope[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ApiScope => (API_SCOPES as readonly string[]).includes(String(item)));
  } catch {
    return [];
  }
}

export function parsePageLimit(value: string | undefined): number {
  if (value == null || value === "") return API_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return API_PAGE_SIZE;
  return Math.min(API_PAGE_SIZE, parsed);
}

export function encodePageCursor(parts: readonly string[]): string {
  const bytes = new TextEncoder().encode(parts.join("\u001f"));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePageCursor(value: string, width: number): string[] | null {
  if (!value || value.length > 512) return null;
  try {
    const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
    const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const parts = new TextDecoder().decode(bytes).split("\u001f");
    if (parts.length !== width) return null;
    return parts;
  } catch {
    return null;
  }
}

export function pageOf<T>(rows: readonly T[], limit: number): { page: T[]; more: boolean } {
  if (rows.length <= limit) return { page: [...rows], more: false };
  return { page: rows.slice(0, limit), more: true };
}
