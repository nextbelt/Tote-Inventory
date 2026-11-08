import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";

// jsdom is missing a few browser APIs the app uses
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
window.matchMedia =
  window.matchMedia ||
  (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
// jsdom's window.scrollTo only logs "Not implemented"; pages call it on every
// view change. Tests that assert on it swap in their own spy.
window.scrollTo = () => {};
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
