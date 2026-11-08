// Pure helpers for the "All totes" list: sorting, filtering and the
// per-session remembered choice. No React in here so it is easy to test.
import { itemQty } from "./itemOps";
import { isReservedPosition } from "./reservedRows";
import { toteModifiedTime } from "./time";

export const SORT_OPTIONS = [
  { value: "spot", label: "Spot" },
  { value: "recent", label: "Recently changed" },
  { value: "name", label: "Name" },
];

export const LIST_PREFS_KEY = "totes-list-prefs";

const bySpot = (a, b) =>
  String(a.position).localeCompare(String(b.position), undefined, {
    numeric: true,
  });

const byName = (a, b) =>
  String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

/** Totes a person can see: never a reserved "__" row, never a null. */
export function listableTotes(totes) {
  return (Array.isArray(totes) ? totes : []).filter(
    (tote) =>
      tote &&
      typeof tote.position === "string" &&
      !isReservedPosition(tote.position)
  );
}

export function sortTotes(totes, sort = "spot") {
  const copy = [...totes];
  if (sort === "name") return copy.sort((a, b) => byName(a, b) || bySpot(a, b));
  if (sort === "recent") {
    return copy.sort(
      (a, b) => toteModifiedTime(b) - toteModifiedTime(a) || bySpot(a, b)
    );
  }
  return copy.sort(bySpot);
}

export const tagKey = (tag) => String(tag).trim().toLocaleLowerCase();

export function toteTags(tote) {
  return Array.isArray(tote?.tags)
    ? tote.tags.filter((t) => typeof t === "string" && t.trim())
    : [];
}

/** Does this tote hold an item at quantity 0? (Items with no qty count as 1.) */
export function hasOutOfStock(tote) {
  return (
    Array.isArray(tote?.items) &&
    tote.items.some((item) => item && itemQty(item) === 0)
  );
}

/** Every distinct tag across the totes: [{ key, label, count }], A to Z. */
export function collectTags(totes) {
  const map = new Map();
  totes.forEach((tote) => {
    const seenHere = new Set();
    toteTags(tote).forEach((tag) => {
      const key = tagKey(tag);
      if (seenHere.has(key)) return;
      seenHere.add(key);
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { key, label: tag.trim(), count: 1 });
    });
  });
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
}

/**
 * Apply the filters. Selected tags match ANY (a tote with "Winter" or
 * "Tools"); the out-of-stock filter then narrows further. Tags are ignored
 * when `tagsEnabled` is false (the database has no tags column yet).
 */
export function filterTotes(
  totes,
  { tags = [], outOfStock = false } = {},
  tagsEnabled = true
) {
  const wanted = tagsEnabled ? new Set(tags.map(tagKey)) : new Set();
  return totes.filter((tote) => {
    if (wanted.size > 0 && !toteTags(tote).some((t) => wanted.has(tagKey(t)))) {
      return false;
    }
    if (outOfStock && !hasOutOfStock(tote)) return false;
    return true;
  });
}

const normalizePrefs = (raw) => ({
  sort: SORT_OPTIONS.some((o) => o.value === raw?.sort) ? raw.sort : "spot",
  tags: Array.isArray(raw?.tags)
    ? raw.tags.filter((t) => typeof t === "string")
    : [],
  outOfStock: raw?.outOfStock === true,
});

/** Last choice of this session; defaults when none or storage is blocked. */
export function loadListPrefs() {
  try {
    const text = window.sessionStorage.getItem(LIST_PREFS_KEY);
    return normalizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return normalizePrefs(null);
  }
}

export function saveListPrefs(prefs) {
  try {
    window.sessionStorage.setItem(LIST_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / blocked storage: the choice just lasts until reload.
  }
}
