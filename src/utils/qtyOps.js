// Quantity ops used when a soft-deleted tote is put back.
//
// Undo after a delete restores the SAME row (id, created_at, stored items).
// The Undo snapshot the detail page builds may carry +/- taps that were
// still staged when the delete ran — those never reached the database.
// After the restore, the difference is re-applied as a small idempotent op
// through updateItems (never a snapshot write), so nothing the other phone
// did to the tote in between is clobbered.

import { composeOps, itemQty } from "./itemOps";

const asArray = (items) => (Array.isArray(items) ? items : []);

/** Set an item's quantity to exactly `qty` (≥ 0). Idempotent; no-op when
 *  the item is not in the list. */
export const setQty = (id, qty) => (items) => {
  const n = Number(qty);
  const q = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  return asArray(items).map((it) => (it && it.id === id ? { ...it, qty: q } : it));
};

/**
 * One op that brings `stored` quantities in line with `snapshot` for items
 * present in BOTH lists (matched by id, never stringified). Items that only
 * one side has are left alone: an item the other phone removed meanwhile
 * is not resurrected, and one it added is not touched.
 * @returns {(items) => items} or null when every shared item already agrees
 */
export function reconcileQtyOp(snapshot, stored) {
  const have = asArray(stored).filter((it) => it && typeof it === "object");
  const ops = [];
  asArray(snapshot).forEach((want) => {
    if (!want || typeof want !== "object") return;
    const current = have.find((it) => it.id === want.id);
    if (!current) return;
    const q = itemQty(want);
    if (q !== itemQty(current)) ops.push(setQty(want.id, q));
  });
  return ops.length > 0 ? composeOps(...ops) : null;
}
