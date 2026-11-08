/* global importScripts */
// Minimal offline shell: cache-first for hashed build assets, network-first
// for navigations (falling back to the cached shell when offline).
// Data itself is mirrored to localStorage by the app, so browsing inventory
// works offline; writes stay online-only by design.
//
// Item photos (Supabase Storage public bucket, cross-origin) get their own
// cache-first strategy in a SEPARATE cache, "tote-photos-v1", that the shell
// cleanup below never deletes. Matching/eviction logic lives in
// /sw-photos.js (shared with the Vitest suite); the app can warm the cache
// with postMessage({ type: "prefetch-photos", urls: [...] }).
importScripts("/sw-photos.js");
const Photos = self.TotePhotos;

const CACHE = "tote-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          Photos.staleCacheNames(keys, CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Item photos: cache first, any origin (Supabase Storage is cross-origin)
  if (Photos.isPhotoRequest(request)) {
    event.respondWith(
      Photos.respondWithPhoto(request, caches, (r, init) => fetch(r, init), event)
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase calls

  // Navigations: network first, cached shell offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed assets + icons: cache first
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches
        .match(request)
        .then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
              return res;
            })
        )
        .catch(() => Response.error())
    );
  }
});

// Background photo warm-up requested by the app (see src/utils/photoPrefetch.js)
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "prefetch-photos") return;
  event.waitUntil(
    Photos.prefetchPhotos(data.urls, caches, (r, init) => fetch(r, init))
  );
});
