// Ask the service worker to warm its offline photo cache ("tote-photos-v1")
// for these image URLs. Fire-and-forget: a no-op when there is no controlling
// service worker (dev server, first load before activation, unsupported
// browsers). The worker re-validates every URL, skips ones already cached and
// ignores failures. Returns the number of URLs posted.
export function prefetchPhotos(urls) {
  if (typeof navigator === "undefined") return 0;
  const controller = navigator.serviceWorker?.controller;
  if (!controller || !Array.isArray(urls)) return 0;

  const clean = [
    ...new Set(
      urls.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    ),
  ];
  if (clean.length === 0) return 0;

  try {
    controller.postMessage({ type: "prefetch-photos", urls: clean });
  } catch {
    return 0;
  }
  return clean.length;
}
