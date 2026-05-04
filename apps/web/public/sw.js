const CACHE_NAME = "chat-v4";
const STATIC_ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Skip non-GET and API requests
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/auth") || url.pathname.startsWith("/users") ||
      url.pathname.startsWith("/messages") || url.pathname.startsWith("/upload") ||
      url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/health")) {
    return;
  }

  // Network-first for hashed assets (JS/CSS), cache-first for others
  const isHashedAsset = url.pathname.match(/\/assets\/.*-[a-zA-Z0-9]{8,}\.(js|css)$/);

  if (isHashedAsset) {
    // Network-first: always try fresh copy
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request)).catch(() => caches.match("/index.html"))
    );
  } else {
    // Network-first for index.html and other static (ensures fresh deploys are picked up)
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request)).catch(() => caches.match("/index.html"))
    );
  }
});
