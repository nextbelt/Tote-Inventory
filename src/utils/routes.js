/**
 * Routes. The app has no router; every screen is a query string, written with
 * history.pushState so the browser / iOS back gesture steps through screens.
 *
 *   /?tote=<id>     open one tote (ids are integers in the DB)
 *   /?edit=<id>     rename / edit one tote
 *   /?new=B3        new-tote form for that slot
 *   /?slot=B3       label entry point: the tote in that slot, or the new-tote
 *                   form when it is empty (the app rewrites it to tote / new)
 *   /?wall=left&q=tarp&mode=list   garage / All totes view state
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

  const edit = params.get("edit");
  if (edit != null) {
    const toteId = parseToteId(edit);
    if (toteId !== null && !(typeof toteId === "string" && isReservedPosition(toteId))) {
      return { view: "edit", toteId };
    }
  }

  const fresh = params.get("new");
  if (fresh != null) {
    const position = fresh.trim();
    if (position && !isReservedPosition(position)) {
      return { view: "new", position };
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

export function buildEditUrl(origin, id) {
  return `${stripSlash(origin)}/?edit=${encodeURIComponent(String(id))}`;
}

export function buildNewUrl(origin, position) {
  return `${stripSlash(origin)}/?new=${encodeURIComponent(String(position))}`;
}

/**
 * Garage / All totes view state as a URL. Defaults are left out so the
 * ordinary garage stays a clean "/".
 */
export function buildGridUrl({ wall, q, mode } = {}) {
  const params = new URLSearchParams();
  if (wall && wall !== "front") params.set("wall", wall);
  if (q) params.set("q", q);
  if (mode === "list") params.set("mode", "list");
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

// ---------------------------------------------------------------------------
// History bookkeeping: every entry the app pushes carries its depth, so a
// Back button knows whether there is an in-app screen to step back to.
// ---------------------------------------------------------------------------

const NAV_KEY = "garageTotesNav";

/** history.state for an entry that is `depth` screens into the session. */
export function navState(depth) {
  return { [NAV_KEY]: true, depth };
}

/** Depth stored on a history entry, or null for an entry the app did not write. */
export function historyDepth(state) {
  if (state && state[NAV_KEY] && Number.isInteger(state.depth) && state.depth >= 0) {
    return state.depth;
  }
  return null;
}
