// Detection of legacy data problems, fixable from the Tidy Up sheet:
//  - duplicate rows per position (the live table predates the UNIQUE
//    constraint; an old bug silently inserted stale copies)
//  - photos embedded as base64 data-URIs inside the items JSONB (multi-MB
//    rows that slow every load and overflow the offline cache)
//
// Reserved "__" rows (layout settings, the removed-items bin, deleted-tote
// tombstones) are never legacy problems and are skipped by every detector.

import { REMOVED_ITEMS_POSITION, isReservedPosition } from "./reservedRows";

const realTotes = (totes) =>
  (Array.isArray(totes) ? totes : []).filter(
    (tote) => tote && !isReservedPosition(tote.position)
  );

const time = (t) => new Date(t.updated_at || t.created_at || 0).getTime();

/**
 * Group totes that share a position. The newest (by updated_at) is kept —
 * it's the one every version of the app has always displayed.
 * @returns {Array<{ position, keep, older: tote[] }>}
 */
export function findDuplicates(totes) {
  const byPosition = new Map();
  realTotes(totes).forEach((tote) => {
    const list = byPosition.get(tote.position) || [];
    list.push(tote);
    byPosition.set(tote.position, list);
  });

  const groups = [];
  byPosition.forEach((list, position) => {
    if (list.length < 2) return;
    const sorted = [...list].sort((a, b) => time(b) - time(a));
    groups.push({ position, keep: sorted[0], older: sorted.slice(1) });
  });
  return groups.sort((a, b) =>
    a.position.localeCompare(b.position, undefined, { numeric: true })
  );
}

/** Items whose photo is an embedded data-URI (not a storage URL). */
export function findEmbeddedPhotos(totes) {
  const found = [];
  realTotes(totes).forEach((tote) => {
    (Array.isArray(tote.items) ? tote.items : []).forEach((item) => {
      if (typeof item.image === "string" && item.image.startsWith("data:")) {
        found.push({ tote, item });
      }
    });
  });
  return found;
}

/** Byte-ish size of the embedded photos (base64 length ≈ bytes × 4/3). */
export function embeddedPhotoBytes(totes) {
  return findEmbeddedPhotos(totes).reduce(
    (sum, { item }) => sum + Math.round(item.image.length * 0.75),
    0
  );
}

const isDataUri = (v) => typeof v === "string" && v.startsWith("data:");
const stripItem = (item) =>
  item && typeof item === "object" && isDataUri(item.image) ? { ...item, image: null } : item;
// Removed-items bin entries nest the item one level down ({ item: {...} })
const stripEntry = (entry) =>
  entry && typeof entry === "object" && isDataUri(entry.item?.image)
    ? { ...entry, item: { ...entry.item, image: null } }
    : entry;

/** Replace data-URI images with null for the offline cache (display-only
 *  mirror; a multi-MB row would overflow the localStorage quota). Covers
 *  both tote items and the removed-items bin's nested `entry.item`. */
export function stripForCache(totes) {
  return totes.map((tote) => {
    const items = Array.isArray(tote.items) ? tote.items : [];
    const strip =
      tote.position === REMOVED_ITEMS_POSITION
        ? (e) => stripItem(stripEntry(e))
        : stripItem;
    const next = items.map(strip);
    return next.some((it, i) => it !== items[i]) ? { ...tote, items: next } : tote;
  });
}

export function dataUriToBlob(dataUri) {
  const [meta, base64] = dataUri.split(",");
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
