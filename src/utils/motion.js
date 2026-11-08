/**
 * True when the user has asked the OS for less motion — scroll jumps and
 * highlight pulses then switch to their instant / static variants.
 * Safe outside a browser (tests, SSR), where it reports false.
 */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
