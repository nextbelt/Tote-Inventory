// Item edits as OPERATIONS, not snapshots.
//
// Two phones edit the same tote at the same time. If each one saved its
// whole `items` array, whichever saved last would silently erase the
// other's change. Instead every edit is a small pure function
// `items → items` that the service applies to the freshest stored copy
// (and the detail page applies on top of the live store for an instant,
// optimistic view). Every op is idempotent and keyed by item id, so the
// same op can safely be re-applied after a lost compare-and-swap race.

/** Quantity of an item, defaulting to 1 for legacy rows without `qty`. */
export const itemQty = (item) => {
  const q = Number(item?.qty);
  return Number.isFinite(q) && q >= 0 ? q : 1;
};

const asArray = (items) => (Array.isArray(items) ? items : []);

/** Append `item` unless an item with the same id already exists. */
export const addItem = (item) => (items) => {
  const list = asArray(items);
  return list.some((it) => it.id === item.id) ? list : [...list, item];
};

/** Remove the item with this id (no-op when it is already gone). */
export const removeItem = (id) => (items) =>
  asArray(items).filter((it) => it.id !== id);

/** Change an item's quantity by `delta`, never below zero. */
export const adjustQty = (id, delta) => (items) =>
  asArray(items).map((it) =>
    it.id === id ? { ...it, qty: Math.max(0, itemQty(it) + delta) } : it
  );

/**
 * Put `item` back at `index` (for Undo) unless it already exists. The
 * index is clamped, so it still works when the list shrank meanwhile.
 */
export const restoreItem = (item, index) => (items) => {
  const list = asArray(items);
  if (list.some((it) => it.id === item.id)) return list;
  const at = Math.min(Math.max(0, Number(index) || 0), list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
};

/** Replace the photo of one item (photo migration). */
export const setItemImage = (id, image) => (items) =>
  asArray(items).map((it) => (it.id === id ? { ...it, image } : it));

const EDITABLE_FIELDS = ["name", "image", "qty", "note"];

/**
 * Edit one item: shallow-merge `fields` (only name / image / qty / note are
 * taken; anything else is ignored) into the item with this id. `qty` is an
 * absolute set, clamped at zero; a non-numeric qty is ignored. `note` is
 * trimmed; an empty, blank or null note REMOVES the key (so an item without
 * a note never carries `note: ""`). No-op when the id is gone — the caller
 * can tell by checking the saved list.
 */
export const updateItem = (id, fields) => (items) => {
  const list = asArray(items);
  const patch = {};
  let clearNote = false;
  EDITABLE_FIELDS.forEach((key) => {
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, key)) return;
    if (key === "qty") {
      const q = Number(fields.qty);
      if (!Number.isFinite(q)) return;
      patch.qty = Math.max(0, q);
    } else if (key === "note") {
      const note = typeof fields.note === "string" ? fields.note.trim() : "";
      if (note) patch.note = note;
      else clearNote = true;
    } else {
      patch[key] = fields[key];
    }
  });
  if (Object.keys(patch).length === 0 && !clearNote) return list;
  return list.map((it) => {
    if (it.id !== id) return it;
    const next = { ...it, ...patch };
    if (clearNote) delete next.note;
    return next;
  });
};

/** Apply several ops in order as one op. */
export const composeOps =
  (...ops) =>
  (items) =>
    ops.reduce((acc, op) => op(acc), asArray(items));

/**
 * Items added/removed between two lists, as ONE op on the live list — or
 * null when nothing was added or removed. Diffing by id against the
 * snapshot a form opened with means saving a rename never reverts item
 * changes made meanwhile on the other phone (or a quantity tap still
 * saving from the detail page).
 */
export const diffItemsOp = (before, after) => {
  const prev = asArray(before);
  const next = asArray(after);
  const beforeIds = new Set(prev.map((it) => it.id));
  const afterIds = new Set(next.map((it) => it.id));
  const removed = prev.filter((it) => !afterIds.has(it.id));
  const added = next.filter((it) => !beforeIds.has(it.id));
  if (removed.length === 0 && added.length === 0) return null;
  return composeOps(
    ...removed.map((it) => removeItem(it.id)),
    ...added.map((it) => addItem(it))
  );
};

/** Shallow sanity check for anything an op returns before it is stored. */
export const normalizeItems = (items) =>
  asArray(items).filter((it) => it && typeof it === "object");
