// Detection of legacy data problems, fixable from the Tidy Up sheet:
//  - duplicate rows per position (the live table predates the UNIQUE
//    constraint; an old bug silently inserted stale copies)
//  - photos embedded as base64 data-URIs inside the items JSONB (multi-MB
//    rows that slow every load and overflow the offline cache)

const time = (t) => new Date(t.updated_at || t.created_at || 0).getTime();

/**
 * Group totes that share a position. The newest (by updated_at) is kept —
 * it's the one every version of the app has always displayed.
 * @returns {Array<{ position, keep, older: tote[] }>}
 */
export function findDuplicates(totes) {
  const byPosition = new Map();
  totes.forEach((tote) => {
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
  totes.forEach((tote) => {
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

/** Replace data-URI images with null for the offline cache (display-only
 *  mirror; a multi-MB row would overflow the localStorage quota). */
export function stripForCache(totes) {
  return totes.map((tote) => {
    const items = Array.isArray(tote.items) ? tote.items : [];
    if (!items.some((i) => typeof i.image === "string" && i.image.startsWith("data:"))) {
      return tote;
    }
    return {
      ...tote,
      items: items.map((item) =>
        typeof item.image === "string" && item.image.startsWith("data:")
          ? { ...item, image: null }
          : item
      ),
    };
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
