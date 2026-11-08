// Reserved rows in the `totes` table.
//
// The app has no extra tables, so a few app-level records live in hidden
// rows of `totes` whose position starts with "__". EVERY such row is
// invisible to the garage walls (see toteService.splitConfig):
//
//   "__config__"                      layout settings (items = settings object)
//   "__removed_items__"               the removed-items bin (items = entries)
//   "__deleted__:<position>:<id>"     a soft-deleted tote (tombstone) — the
//                                     row keeps its id, name, items and
//                                     created_at; updated_at is the moment it
//                                     was deleted. The slot is freed at once
//                                     and the tote can be restored for 30 days.
//
// Anything else starting with "__" is reserved for the future and hidden.
// Position strings are stable IDs — never rename these.

export const RESERVED_PREFIX = "__";
export const CONFIG_POSITION = "__config__";
export const REMOVED_ITEMS_POSITION = "__removed_items__";
export const DELETED_PREFIX = "__deleted__:";

/** How long soft-deleted totes and removed items are kept. */
export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Hard cap on removed-items entries (newest kept). */
export const MAX_REMOVED_ENTRIES = 200;

const asArray = (v) => (Array.isArray(v) ? v : []);

export const isReservedPosition = (position) =>
  typeof position === "string" && position.startsWith(RESERVED_PREFIX);

export const isTombstonePosition = (position) =>
  typeof position === "string" && position.startsWith(DELETED_PREFIX);

/** Tombstone position for a deleted tote — unique per tote, never collides. */
export const tombstonePosition = (originalPosition, id) =>
  `${DELETED_PREFIX}${originalPosition}:${id}`;

/** @returns {{ originalPosition: string, idSegment: string } | null} */
export function parseTombstone(position) {
  if (!isTombstonePosition(position)) return null;
  const rest = position.slice(DELETED_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  return { originalPosition: rest.slice(0, cut), idSegment: rest.slice(cut + 1) };
}

/**
 * Tombstone row → entry for the "recently deleted" list. The row's own id
 * is the tote id (the id inside the position string is only there to make
 * the position unique).
 */
export function toDeletedEntry(row) {
  const parsed = parseTombstone(row?.position);
  if (!parsed) return null;
  return {
    id: row.id,
    name: row.name,
    originalPosition: parsed.originalPosition,
    deletedAt: row.updated_at || row.created_at || null,
    items: asArray(row.items),
    created_at: row.created_at ?? null,
  };
}

/** True when `isoTime` is more than the retention window ago. Unknown or
 *  unparsable times are NOT expired (never purge what we can't date). */
export function isExpired(isoTime, now = Date.now()) {
  if (!isoTime) return false;
  const t = new Date(isoTime).getTime();
  return Number.isFinite(t) && now - t > RETENTION_MS;
}

// ---------------------------------------------------------------------------
// Removed-items bin entries
//   { id: "<toteId>:<itemId>:<removedAt>", item, toteId, toteName, position, removedAt }
// ---------------------------------------------------------------------------

export const removedEntryId = (toteId, itemId, removedAt) =>
  `${toteId}:${itemId}:${removedAt}`;

export const isRemovedEntry = (entry) =>
  Boolean(
    entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      entry.item &&
      typeof entry.item === "object"
  );

const isDataUri = (v) => typeof v === "string" && v.startsWith("data:");

/**
 * An item safe to keep in the bin: an embedded base64 photo is dropped
 * (null). The bin holds up to 200 entries, and one legacy data-URI can be
 * several MB — enough to overflow the offline cache (cloud) or the whole
 * store (local mode). Storage URLs are kept.
 */
export const stripEmbeddedImage = (item) =>
  isDataUri(item?.image) ? { ...item, image: null } : item;

/** Build bin entries for items removed from `tote` at `removedAt`. */
export function makeRemovedEntries(tote, items, removedAt = new Date().toISOString()) {
  return asArray(items)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: removedEntryId(tote?.id, item.id, removedAt),
      item: stripEmbeddedImage(item),
      toteId: tote?.id ?? null,
      toteName: tote?.name ?? "",
      position: tote?.position ?? null,
      removedAt,
    }));
}

/** Drop malformed and expired entries, newest first, capped. Pure. */
export function pruneRemovedEntries(entries, now = Date.now()) {
  return asArray(entries)
    .filter((e) => isRemovedEntry(e) && !isExpired(e.removedAt, now))
    .sort(
      (a, b) =>
        new Date(b.removedAt || 0).getTime() - new Date(a.removedAt || 0).getTime()
    )
    .slice(0, MAX_REMOVED_ENTRIES);
}

/**
 * Item-op (items → items) for the bin row: append `entries` (idempotent by
 * entry id) and prune. Applied through the compare-and-swap path, so two
 * phones removing items at once both land.
 */
export const appendRemovedEntries =
  (entries, now = Date.now()) =>
  (items) => {
    const list = asArray(items);
    const have = new Set(list.map((e) => e?.id));
    const fresh = asArray(entries).filter((e) => isRemovedEntry(e) && !have.has(e.id));
    return pruneRemovedEntries([...list, ...fresh], now);
  };

/** Flatten every bin row's entries into one pruned list. */
export function removedEntriesFromRows(rows, now = Date.now()) {
  const all = [];
  asArray(rows).forEach((row) => {
    if (row?.position !== REMOVED_ITEMS_POSITION) return;
    asArray(row.items).forEach((e) => all.push(e));
  });
  return pruneRemovedEntries(all, now);
}
