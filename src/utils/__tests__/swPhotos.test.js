import { describe, it, expect, vi } from "vitest";
import {
  fakeResponse,
  loadServiceWorker,
  loadTotePhotos,
  makeCache,
  makeCaches,
  photoUrl,
} from "../../test/swHarness.js";

const P = loadTotePhotos();
const req = (url, method = "GET") => ({ url, method, mode: "no-cors" });

describe("photo URL matching", () => {
  it("matches GET requests to the Supabase public tote-images bucket", () => {
    expect(P.isPhotoRequest(req(photoUrl(1)))).toBe(true);
    expect(P.isPhotoRequest(req(photoUrl("a/b", "https://x.y.supabase.co")))).toBe(true);
  });

  it("ignores other paths, buckets and the REST/realtime APIs", () => {
    const host = "https://abc.supabase.co";
    expect(P.isPhotoRequest(req(`${host}/rest/v1/totes?select=*`))).toBe(false);
    expect(
      P.isPhotoRequest(req(`${host}/storage/v1/object/public/other-bucket/1.jpg`))
    ).toBe(false);
    expect(
      P.isPhotoRequest(req(`${host}/storage/v1/object/sign/tote-images/1.jpg`))
    ).toBe(false);
    expect(P.isPhotoRequest(req(`${host}/x/storage/v1/object/public/tote-images/1.jpg`))).toBe(
      false
    );
    expect(P.isPhotoRequest(req("https://garage.example/assets/app.js"))).toBe(false);
    expect(P.isPhotoRequest(req("not a url"))).toBe(false);
    expect(P.isPhotoRequest(null)).toBe(false);
  });

  it("ignores non-GET requests", () => {
    expect(P.isPhotoRequest(req(photoUrl(1), "POST"))).toBe(false);
    expect(P.isPhotoRequest(req(photoUrl(1), "PUT"))).toBe(false);
    expect(P.isPhotoRequest(req(photoUrl(1), "DELETE"))).toBe(false);
  });

  it("only accepts http(s) URLs", () => {
    expect(P.isPhotoUrl("ftp://h/storage/v1/object/public/tote-images/1.jpg")).toBe(false);
    expect(P.isPhotoUrl(undefined)).toBe(false);
  });
});

describe("cacheability", () => {
  it("accepts ok and opaque responses", () => {
    expect(P.isCacheable(fakeResponse())).toBe(true);
    expect(P.isCacheable(fakeResponse({ status: 0, type: "opaque" }))).toBe(true);
    expect(P.isCacheable(fakeResponse({ status: 200, type: "cors" }))).toBe(true);
  });

  it("rejects errors, partials and missing responses", () => {
    expect(P.isCacheable(fakeResponse({ status: 404 }))).toBe(false);
    expect(P.isCacheable(fakeResponse({ status: 500 }))).toBe(false);
    expect(P.isCacheable(fakeResponse({ status: 206 }))).toBe(false);
    expect(P.isCacheable(fakeResponse({ status: 0, type: "error" }))).toBe(false);
    expect(P.isCacheable(null)).toBe(false);
  });
});

describe("storePhoto / eviction", () => {
  it("caches opaque responses and never caches errors", async () => {
    const cache = makeCache();
    expect(await P.storePhoto(cache, req(photoUrl(1)), fakeResponse({ status: 0, type: "opaque" }))).toBe(true);
    expect(await P.storePhoto(cache, req(photoUrl(2)), fakeResponse({ status: 404 }))).toBe(false);
    expect(await P.storePhoto(cache, req(photoUrl(3)), fakeResponse({ status: 500 }))).toBe(false);
    expect([...cache.store.keys()]).toEqual([photoUrl(1)]);
  });

  it("evicts the oldest entries first once past the cap", async () => {
    const cache = makeCache();
    for (let i = 1; i <= 5; i++) {
      await P.storePhoto(cache, req(photoUrl(i)), fakeResponse(), 3);
    }
    expect([...cache.store.keys()]).toEqual([photoUrl(3), photoUrl(4), photoUrl(5)]);
  });

  it("defaults to a 300 entry cap", async () => {
    expect(P.MAX_ENTRIES).toBe(300);
    const cache = makeCache();
    for (let i = 0; i < 305; i++) cache.store.set(photoUrl(i), fakeResponse());
    expect(await P.trimCache(cache)).toBe(5);
    expect(cache.store.size).toBe(300);
    expect(cache.store.has(photoUrl(4))).toBe(false);
    expect(cache.store.has(photoUrl(5))).toBe(true);
  });

  it("does not delete anything under the cap and survives put failures", async () => {
    const cache = makeCache();
    cache.store.set(photoUrl(1), fakeResponse());
    expect(await P.trimCache(cache, 5)).toBe(0);
    cache.put = async () => {
      throw new Error("QuotaExceededError");
    };
    expect(await P.storePhoto(cache, req(photoUrl(2)), fakeResponse())).toBe(false);
  });

  it("coalesces concurrent trims but still ends at the cap", async () => {
    const cache = makeCache();
    const keysSpy = vi.spyOn(cache, "keys");
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => P.storePhoto(cache, req(photoUrl(i)), fakeResponse(), 2))
    );
    expect(cache.store.size).toBe(2);
    expect(keysSpy.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("respondWithPhoto (cache first)", () => {
  it("returns a cached photo without touching the network", async () => {
    const caches = makeCaches();
    const cached = fakeResponse();
    (await caches.open(P.PHOTO_CACHE)).store.set(photoUrl(1), cached);
    const fetchFn = vi.fn();
    const res = await P.respondWithPhoto(req(photoUrl(1)), caches, fetchFn);
    expect(res).toBe(cached);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches on a miss with CORS, stores an ok copy via waitUntil, returns the original", async () => {
    const caches = makeCaches();
    const net = fakeResponse();
    const fetchFn = vi.fn(async () => net);
    const waits = [];
    const res = await P.respondWithPhoto(req(photoUrl(2)), caches, fetchFn, {
      waitUntil: (p) => waits.push(p),
    });
    expect(res).toBe(net);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(photoUrl(2), { mode: "cors", credentials: "omit" });
    await Promise.all(waits);
    const cache = await caches.open(P.PHOTO_CACHE);
    expect(cache.store.get(photoUrl(2)).cloned).toBe(true);
  });

  it("does not cache a CORS 404/502 so a transient failure is not permanent", async () => {
    for (const status of [404, 502]) {
      const caches = makeCaches();
      const net = fakeResponse({ status });
      const fetchFn = vi.fn(async () => net);
      const waits = [];
      const res = await P.respondWithPhoto(req(photoUrl(3)), caches, fetchFn, {
        waitUntil: (p) => waits.push(p),
      });
      expect(res).toBe(net);
      await Promise.all(waits);
      expect((await caches.open(P.PHOTO_CACHE)).store.size).toBe(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("when CORS is blocked, falls back to the no-cors request and does not cache the opaque result", async () => {
    const caches = makeCaches();
    const request = req(photoUrl(6));
    const opaque = fakeResponse({ status: 0, type: "opaque" });
    const fetchFn = vi.fn(async (arg) => {
      if (arg !== request) throw new TypeError("cors blocked");
      return opaque;
    });
    const waits = [];
    const res = await P.respondWithPhoto(request, caches, fetchFn, {
      waitUntil: (p) => waits.push(p),
    });
    expect(res).toBe(opaque);
    expect(waits).toHaveLength(0);
    expect((await caches.open(P.PHOTO_CACHE)).store.size).toBe(0);
  });

  it("a failure followed by a later success ends up cached (no poisoning)", async () => {
    const caches = makeCaches();
    const responses = [fakeResponse({ status: 502 }), fakeResponse()];
    const fetchFn = vi.fn(async () => responses.shift());
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    await P.respondWithPhoto(req(photoUrl(7)), caches, fetchFn, ctx);
    await P.respondWithPhoto(req(photoUrl(7)), caches, fetchFn, ctx);
    await Promise.all(waits);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await caches.open(P.PHOTO_CACHE)).store.has(photoUrl(7))).toBe(true);
  });

  it("rejects (image error) when offline and uncached", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(P.respondWithPhoto(req(photoUrl(4)), makeCaches(), fetchFn)).rejects.toThrow("offline");
    expect(fetchFn).toHaveBeenCalledTimes(2); // cors attempt, then the original request
  });

  it("falls back to the network when the cache cannot be opened", async () => {
    const net = fakeResponse();
    const broken = { open: async () => { throw new Error("denied"); } };
    expect(await P.respondWithPhoto(req(photoUrl(5)), broken, async () => net)).toBe(net);
  });
});

describe("prefetchPhotos", () => {
  it("fetches and stores uncached photo URLs, skipping cached, duplicate and foreign ones", async () => {
    const caches = makeCaches();
    const cache = await caches.open(P.PHOTO_CACHE);
    cache.store.set(photoUrl(1), fakeResponse());
    const fetchFn = vi.fn(async () => fakeResponse());
    const stored = await P.prefetchPhotos(
      [photoUrl(1), photoUrl(2), photoUrl(2), photoUrl(3), "https://evil.example/x.jpg", 42, null],
      caches,
      fetchFn
    );
    expect(stored).toBe(2);
    expect(fetchFn.mock.calls.map((c) => c[0]).sort()).toEqual([photoUrl(2), photoUrl(3)]);
    expect([...cache.store.keys()].sort()).toEqual([photoUrl(1), photoUrl(2), photoUrl(3)]);
  });

  it("ignores failures and does not cache error responses", async () => {
    const caches = makeCaches();
    const fetchFn = vi.fn(async (url) => {
      if (url === photoUrl(1)) throw new TypeError("offline");
      if (url === photoUrl(2)) return fakeResponse({ status: 404 });
      return fakeResponse();
    });
    const stored = await P.prefetchPhotos([photoUrl(1), photoUrl(2), photoUrl(3)], caches, fetchFn);
    expect(stored).toBe(1);
    expect([...(await caches.open(P.PHOTO_CACHE)).store.keys()]).toEqual([photoUrl(3)]);
  });

  it("never caches an opaque prefetch result (status unknowable)", async () => {
    const caches = makeCaches();
    const fetchFn = vi.fn(async () => fakeResponse({ status: 0, type: "opaque" }));
    expect(await P.prefetchPhotos([photoUrl(1)], caches, fetchFn)).toBe(0);
    expect(fetchFn.mock.calls.map((c) => c[1].mode)).toEqual(["cors"]);
    expect((await caches.open(P.PHOTO_CACHE)).store.size).toBe(0);
  });

  it("limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return fakeResponse();
    };
    const urls = Array.from({ length: 12 }, (_, i) => photoUrl(i));
    await P.prefetchPhotos(urls, makeCaches(), fetchFn);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(P.PREFETCH_CONCURRENCY);
  });

  it("respects the cap while warming and tolerates a non-array", async () => {
    const caches = makeCaches();
    const urls = [1, 2, 3, 4].map((n) => photoUrl(n));
    await P.prefetchPhotos(urls, caches, async () => fakeResponse(), { concurrency: 1, max: 2 });
    expect((await caches.open(P.PHOTO_CACHE)).store.size).toBe(2);
    expect(await P.prefetchPhotos("nope", caches, vi.fn())).toBe(0);
  });
});

describe("service worker wiring (public/sw.js)", () => {
  it("activate deletes old shell caches but keeps the current shell and photo caches", async () => {
    const caches = makeCaches(["tote-shell-v0", "tote-shell-v1", "tote-photos-v1", "junk"]);
    const sw = loadServiceWorker({ caches, fetch: vi.fn() });
    const { settled } = sw.dispatch("activate", {});
    await settled();
    expect([...caches.map.keys()].sort()).toEqual(["tote-photos-v1", "tote-shell-v1"]);
  });

  it("staleCacheNames never lists the photo cache", () => {
    expect(P.staleCacheNames(["tote-photos-v1", "a", "tote-shell-v1"], "tote-shell-v1")).toEqual(["a"]);
  });

  it("serves bucket photos cache-first and leaves other cross-origin requests alone", async () => {
    const caches = makeCaches();
    const net = fakeResponse();
    const fetchFn = vi.fn(async () => net);
    const sw = loadServiceWorker({ caches, fetch: fetchFn });

    const photo = sw.dispatch("fetch", { request: req(photoUrl(9)) });
    expect(await photo.ev.responded).toBe(net);
    await photo.settled();
    expect((await caches.open("tote-photos-v1")).store.has(photoUrl(9))).toBe(true);

    const other = sw.dispatch("fetch", {
      request: req("https://abc.supabase.co/rest/v1/totes?select=*"),
    });
    expect(other.ev.responded).toBeUndefined();
    const post = sw.dispatch("fetch", { request: req(photoUrl(9), "POST") });
    expect(post.ev.responded).toBeUndefined();
  });

  it("handles prefetch-photos messages and ignores everything else", async () => {
    const caches = makeCaches();
    const fetchFn = vi.fn(async () => fakeResponse());
    const sw = loadServiceWorker({ caches, fetch: fetchFn });

    const ignored = sw.dispatch("message", { data: { type: "something-else", urls: [photoUrl(1)] } });
    await ignored.settled();
    sw.dispatch("message", { data: null });
    expect(fetchFn).not.toHaveBeenCalled();

    const warm = sw.dispatch("message", {
      data: { type: "prefetch-photos", urls: [photoUrl(1), photoUrl(2), "https://evil.example/a.jpg"] },
    });
    await warm.settled();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect([...(await caches.open("tote-photos-v1")).store.keys()].sort()).toEqual([
      photoUrl(1),
      photoUrl(2),
    ]);
  });
});
