/* Floor shell. Network-first for pages and assets. /api is not intercepted and is never cached.
   The plan matches shellCachePlan in src/domain/offline-shell.ts. */

const CACHE = "rackline-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      if (request.mode === "navigate") await cache.put("/index.html", res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = (await cache.match("/index.html")) || (await cache.match("/"));
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  event.respondWith(networkFirst(event.request));
});
