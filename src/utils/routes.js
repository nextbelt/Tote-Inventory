/**
 * Deep-link routes. The app has no router; entry points read the query string.
 *
 *   /?tote=<id>     open one tote (ids are integers in the DB)
 *   /?slot=B3       open whatever tote is in that slot (shelf-edge labels)
 *   /?wall=left&q=tarp&mode=...   grid view state
 */

const DIGITS = /^\d+$/;

/** Digit-only → Number when it is a safe integer, otherwise keep the string. */
export function parseToteId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (DIGITS.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return s;
}

/** Positions starting with "__" are reserved (e.g. the hidden settings row). */
export function isReservedPosition(position) {
  return String(position).startsWith("__");
}

export function parseRoute(search) {
  const params = new URLSearchParams(search || "");

  const tote = params.get("tote");
  if (tote != null) {
    const toteId = parseToteId(tote);
    if (toteId !== null && !(typeof toteId === "string" && isReservedPosition(toteId))) {
      return { view: "tote", toteId };
    }
  }

  const slot = params.get("slot");
  if (slot != null) {
    const position = slot.trim();
    if (position && !isReservedPosition(position)) {
      return { view: "slot", position };
    }
  }

  const route = { view: "grid" };
  for (const key of ["wall", "q", "mode"]) {
    const v = params.get(key);
    if (v) route[key] = v;
  }
  return route;
}

function stripSlash(origin) {
  return String(origin || "").replace(/\/+$/, "");
}

export function buildToteUrl(origin, id) {
  return `${stripSlash(origin)}/?tote=${encodeURIComponent(String(id))}`;
}

export function buildSlotUrl(origin, position) {
  return `${stripSlash(origin)}/?slot=${encodeURIComponent(String(position))}`;
}
