// Offline item photos: pure-ish helpers for the service worker.
//
// Loaded two ways:
//  - public/sw.js pulls it in with importScripts("/sw-photos.js"), which
//    defines `self.TotePhotos` (a classic script; no module syntax allowed).
//  - Vitest reads the file and evaluates it against a fake `self`
//    (see src/test/loadSwPhotos.js), so the logic is testable without a
//    real service worker.
//
// Everything that touches the Cache API takes the cache (or caches) object as
// an argument so tests can pass in-memory fakes.
(function (root) {
  "use strict";

  // Own cache: sw.js's "activate" cleanup must never delete this one.
  var PHOTO_CACHE = "tote-photos-v1";
  var MAX_ENTRIES = 300;
  var PREFETCH_CONCURRENCY = 3;
  var MAX_PREFETCH_URLS = 200; // per message
  // Supabase Storage public bucket path. Photo URLs are unique per upload
  // (replacing a photo makes a new URL), so cache-first can never go stale.
  var BUCKET_PATH = "/storage/v1/object/public/tote-images/";

  function isPhotoUrl(urlLike) {
    var url;
    try {
      url = new URL(String(urlLike));
    } catch (e) {
      return false;
    }
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname.indexOf(BUCKET_PATH) === 0
    );
  }

  // GET requests to the photo bucket (any origin: the project host is not
  // known to the worker, and the path is specific enough).
  function isPhotoRequest(request) {
    return !!request && request.method === "GET" && isPhotoUrl(request.url);
  }

  // Ok responses and opaque ones (no-cors <img> requests have status 0 and
  // we cannot see more). Never errors, redirects or 206 partials (put()
  // rejects 206).
  function isCacheable(response) {
    if (!response) return false;
    if (response.type === "opaque") return true;
    return response.ok === true && response.status !== 206;
  }

  // Evict the oldest entries beyond `max`. cache.keys() lists entries in
  // insertion order and reading them does not touch response bodies, so this
  // is one cheap call plus a delete per excess entry.
  function trimCache(cache, max) {
    var limit = max == null ? MAX_ENTRIES : max;
    return cache.keys().then(function (keys) {
      var excess = keys.length - limit;
      if (excess <= 0) return 0;
      var victims = keys.slice(0, excess);
      return Promise.all(
        victims.map(function (k) {
          return cache.delete(k);
        })
      ).then(function () {
        return excess;
      });
    });
  }

  // Trims are coalesced: if one is running, the next put just reruns it once
  // afterwards instead of stacking up a trim per put.
  var trimState = new WeakMap();
  function scheduleTrim(cache, max) {
    var st = trimState.get(cache);
    if (!st) {
      st = { running: null, again: false };
      trimState.set(cache, st);
    }
    if (st.running) {
      st.again = true;
      return st.running;
    }
    st.running = trimCache(cache, max)
      .catch(function () {})
      .then(function () {
        st.running = null;
        if (st.again) {
          st.again = false;
          return scheduleTrim(cache, max);
        }
      });
    return st.running;
  }

  // Store a response (if cacheable) and trim. Never throws.
  function storePhoto(cache, request, response, max) {
    if (!isCacheable(response)) return Promise.resolve(false);
    return cache
      .put(request, response)
      .then(function () {
        return scheduleTrim(cache, max);
      })
      .then(
        function () {
          return true;
        },
        function () {
          return false; // quota etc.: the photo still displays from network
        }
      );
  }

  // Cache-first fetch for a photo request. `ctx.waitUntil` (optional) keeps
  // the worker alive for the background cache write.
  function respondWithPhoto(request, cachesApi, fetchFn, ctx) {
    // If the cache itself is unavailable, fall back to a plain network fetch
    // (which also surfaces an offline failure to the <img>).
    return cachesApi
      .open(PHOTO_CACHE)
      .catch(function () {
        return null;
      })
      .then(function (cache) {
        if (!cache) return fetchFn(request);
        return cache
          .match(request)
          .catch(function () {
            return undefined;
          })
          .then(function (hit) {
            if (hit) return hit;
            return fetchFn(request).then(function (res) {
              if (isCacheable(res)) {
                var write = storePhoto(cache, request, res.clone());
                if (ctx && ctx.waitUntil) ctx.waitUntil(write);
              }
              return res;
            });
          });
      });
  }

  // Warm the cache for `urls` in the background. Skips URLs that are not
  // photo URLs or are already cached, runs a few fetches at a time, and
  // ignores every failure. Resolves with the number of photos stored.
  function prefetchPhotos(urls, cachesApi, fetchFn, opts) {
    var concurrency = (opts && opts.concurrency) || PREFETCH_CONCURRENCY;
    var max = opts && opts.max;
    var seen = {};
    var queue = [];
    (Array.isArray(urls) ? urls : []).forEach(function (u) {
      if (typeof u !== "string" || seen[u] || !isPhotoUrl(u)) return;
      seen[u] = true;
      if (queue.length < MAX_PREFETCH_URLS) queue.push(u);
    });
    if (!queue.length) return Promise.resolve(0);

    return cachesApi
      .open(PHOTO_CACHE)
      .then(function (cache) {
        var stored = 0;

        function fetchOne(url) {
          // CORS first so a failed (404) response has a visible status and
          // is not cached; Supabase public buckets send CORS headers. Fall
          // back to an opaque no-cors fetch if that fails.
          return fetchFn(url, { mode: "cors", credentials: "omit" }).catch(
            function () {
              return fetchFn(url, { mode: "no-cors", credentials: "omit" });
            }
          );
        }

        function worker() {
          if (!queue.length) return Promise.resolve();
          var url = queue.shift();
          return cache
            .match(url)
            .then(function (hit) {
              if (hit) return;
              return fetchOne(url).then(function (res) {
                return storePhoto(cache, url, res, max).then(function (ok) {
                  if (ok) stored++;
                });
              });
            })
            .catch(function () {})
            .then(worker);
        }

        var workers = [];
        for (var i = 0; i < concurrency; i++) workers.push(worker());
        return Promise.all(workers).then(function () {
          return stored;
        });
      })
      .catch(function () {
        return 0;
      });
  }

  // Cache names "activate" should delete: everything except the current
  // shell cache and the photo cache.
  function staleCacheNames(keys, shellCache) {
    return keys.filter(function (k) {
      return k !== shellCache && k !== PHOTO_CACHE;
    });
  }

  root.TotePhotos = {
    PHOTO_CACHE: PHOTO_CACHE,
    MAX_ENTRIES: MAX_ENTRIES,
    PREFETCH_CONCURRENCY: PREFETCH_CONCURRENCY,
    MAX_PREFETCH_URLS: MAX_PREFETCH_URLS,
    BUCKET_PATH: BUCKET_PATH,
    isPhotoUrl: isPhotoUrl,
    isPhotoRequest: isPhotoRequest,
    isCacheable: isCacheable,
    trimCache: trimCache,
    storePhoto: storePhoto,
    respondWithPhoto: respondWithPhoto,
    prefetchPhotos: prefetchPhotos,
    staleCacheNames: staleCacheNames,
  };
})(self);
