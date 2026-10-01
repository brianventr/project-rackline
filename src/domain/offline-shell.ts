/**
 * How the floor shell service worker treats a same-origin request.
 * `/api` is never cached. Everything else is tried on the network first and can fall back to the shell cache.
 */
export type ShellCachePlan = "network-only" | "network-first";

export function shellCachePlan(pathname: string, method: string): ShellCachePlan {
  if (method !== "GET" || pathname.startsWith("/api/") || pathname === "/api") return "network-only";
  return "network-first";
}
