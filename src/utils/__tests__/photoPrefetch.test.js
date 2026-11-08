import { describe, it, expect, vi, afterEach } from "vitest";
import { prefetchPhotos } from "../photoPrefetch.js";

const setController = (controller) =>
  Object.defineProperty(navigator, "serviceWorker", {
    value: { controller },
    configurable: true,
  });

afterEach(() => {
  delete navigator.serviceWorker;
});

describe("prefetchPhotos", () => {
  it("posts a prefetch-photos message to the controlling worker", () => {
    const postMessage = vi.fn();
    setController({ postMessage });
    const n = prefetchPhotos(["https://h/a.jpg", "https://h/b.jpg"]);
    expect(n).toBe(2);
    expect(postMessage).toHaveBeenCalledWith({
      type: "prefetch-photos",
      urls: ["https://h/a.jpg", "https://h/b.jpg"],
    });
  });

  it("dedupes and drops non-http strings", () => {
    const postMessage = vi.fn();
    setController({ postMessage });
    prefetchPhotos(["https://h/a.jpg", "https://h/a.jpg", "data:x", "", null, 7, undefined]);
    expect(postMessage).toHaveBeenCalledWith({
      type: "prefetch-photos",
      urls: ["https://h/a.jpg"],
    });
  });

  it("is a no-op without a controller or serviceWorker support", () => {
    expect(prefetchPhotos(["https://h/a.jpg"])).toBe(0);
    setController(null);
    expect(prefetchPhotos(["https://h/a.jpg"])).toBe(0);
  });

  it("does not post an empty list or a non-array", () => {
    const postMessage = vi.fn();
    setController({ postMessage });
    expect(prefetchPhotos([])).toBe(0);
    expect(prefetchPhotos(null)).toBe(0);
    expect(prefetchPhotos([null])).toBe(0);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("swallows postMessage errors", () => {
    setController({ postMessage: () => { throw new Error("gone"); } });
    expect(prefetchPhotos(["https://h/a.jpg"])).toBe(0);
  });
});
