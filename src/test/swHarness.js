// Test harness for the service worker scripts in public/. They are classic
// scripts (not modules), so we read them from disk and evaluate them against
// a fake worker global instead of importing them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* global process */
// Vitest runs from the repo root (jsdom's URL breaks import.meta.url paths).
const read = (name) => readFileSync(resolve(process.cwd(), "public", name), "utf8");

// sw-photos.js on its own: returns the TotePhotos API.
export function loadTotePhotos() {
  const fakeSelf = {};
  new Function("self", read("sw-photos.js"))(fakeSelf);
  return fakeSelf.TotePhotos;
}

// In-memory Cache: keys() lists in insertion order, like the real one.
export function makeCache() {
  const store = new Map();
  const urlOf = (r) => (typeof r === "string" ? r : r.url);
  return {
    store,
    match: async (r) => store.get(urlOf(r)),
    put: async (r, res) => {
      store.set(urlOf(r), res);
    },
    delete: async (r) => store.delete(urlOf(r)),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
}

export function makeCaches(initial = []) {
  const map = new Map(initial.map((n) => [n, makeCache()]));
  return {
    map,
    open: async (n) => {
      if (!map.has(n)) map.set(n, makeCache());
      return map.get(n);
    },
    keys: async () => [...map.keys()],
    delete: async (n) => map.delete(n),
    match: async (r) => {
      for (const c of map.values()) {
        const hit = await c.match(r);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

// Minimal Response stand-in (only what the worker looks at).
export function fakeResponse({ status = 200, type = "basic" } = {}) {
  const res = {
    status,
    type,
    ok: type !== "opaque" && status >= 200 && status < 300,
    clone: () => ({ ...res, cloned: true }),
  };
  return res;
}

export function photoUrl(n, host = "https://abc.supabase.co") {
  return `${host}/storage/v1/object/public/tote-images/${n}.jpg`;
}

// Evaluate public/sw.js and capture the listeners it registers.
export function loadServiceWorker({ caches, fetch } = {}) {
  const listeners = {};
  const fakeSelf = {
    location: { origin: "https://garage.example" },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const importScripts = (name) => {
    if (name !== "/sw-photos.js") throw new Error(`unexpected importScripts(${name})`);
    new Function("self", read("sw-photos.js"))(fakeSelf);
  };
  const Response = { error: () => ({ type: "error", ok: false, status: 0 }) };
  new Function("self", "importScripts", "caches", "fetch", "Response", read("sw.js"))(
    fakeSelf,
    importScripts,
    caches,
    fetch,
    Response
  );

  // Dispatch helper: returns the promises handed to waitUntil/respondWith.
  function dispatch(type, event) {
    const pending = [];
    const ev = {
      ...event,
      waitUntil: (p) => pending.push(p),
      respondWith: (p) => {
        ev.responded = p;
      },
    };
    listeners[type](ev);
    return { ev, settled: () => Promise.all(pending) };
  }
  return { listeners, dispatch, TotePhotos: fakeSelf.TotePhotos };
}
