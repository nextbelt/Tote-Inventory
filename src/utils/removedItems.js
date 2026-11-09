// Helpers for the "Recently deleted" sheet (pure).

import { wallPositions } from "./constants";

/**
 * True when an item with exactly this id (1 is not "1") lives in any of
 * `totes`. Reserved "__" rows are never in `totes` (the store filters them),
 * so this only ever looks at real totes.
 */
export function findToteHolding(totes, itemId) {
  return (
    (Array.isArray(totes) ? totes : []).find(
      (t) =>
        Array.isArray(t?.items) && t.items.some((it) => it && it.id === itemId)
    ) ?? null
  );
}

/**
 * Bin entries still worth offering. An entry is hidden when its item id is
 * already in ANY visible tote — back in the tote it was removed from (an
 * Undo, or the other phone put it back) or moved on to another one since —
 * because "Put back" would then give the same item two homes. Ids are
 * compared with their original types (1 is not "1"). Entries from totes
 * that no longer exist stay (unless the item lives elsewhere), so they can
 * be put into another tote.
 */
export function visibleRemovedEntries(entries, totes) {
  const list = Array.isArray(totes) ? totes : [];
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && entry.item && !findToteHolding(list, entry.item.id)
  );
}

/** Positions of `walls` that no tote occupies, grouped by wall. */
export function freePositionsByWall(walls, totes) {
  const taken = new Set(
    (Array.isArray(totes) ? totes : []).map((t) => t?.position)
  );
  return (Array.isArray(walls) ? walls : [])
    .map((wall) => ({
      wall,
      positions: wallPositions([wall]).filter((p) => !taken.has(p)),
    }))
    .filter((group) => group.positions.length > 0);
}
