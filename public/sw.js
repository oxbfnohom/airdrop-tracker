/* Service worker minimal biar app bisa di-install + kebuka saat offline:
 * - /_next/static + icon: cache-first (gak pernah berubah isi per-nama-file)
 * - halaman (navigate): network-first, fallback ke cache terakhir
 * - /api/**: SELALU network — data harus fresh, gak pernah di-cache
 */
const CACHE = "tracker-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data live — jangan di-intercept sama sekali

  // aset build Next: nama file udah hashed → cache-first aman
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icon-") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((res) => {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // halaman: network-first biar selalu fresh, fallback cache buat offline
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});
