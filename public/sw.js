/* Offline support. After the first visit the whole app (pages + scripts) is cached, so it opens and works without a
 * network connection. Emails/employees are never touched here — they live in IndexedDB on this device.
 * - install: download every file listed in precache.json (written at build time)
 * - pages: network-first (a new deployment is picked up), cached copy when offline
 * - /_next/static (content-hashed): cache-first
 * Only same-origin GET requests are handled. */
const VERSION = "__BUILD_VERSION__";
const CACHE = `ekpi-${VERSION}`;
const SCOPE = self.registration.scope; // e.g. https://ahr87.github.io/employee-email-kpi-analyzer/

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const manifest = await (await fetch(new URL("precache.json", SCOPE), { cache: "reload" })).json();
        await Promise.all(manifest.files.map((f) => cache.add(new Request(new URL(f, SCOPE), { cache: "reload" })).catch(() => undefined)));
      } catch { /* not fatal: pages are cached as they are visited */ }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ekpi-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !req.url.startsWith(SCOPE)) return;
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(async () => (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true })) || (await caches.match(new URL("404.html", SCOPE)))),
  );
});
