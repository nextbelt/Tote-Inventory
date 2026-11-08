// Helpers for the "Recently deleted" sheet (pure).

import { wallPositions } from "./constants";

/**
 * Bin entries still worth offering. An entry is hidden when its item id is
 * already back in the tote it was removed from (an Undo, or the other phone
 * put it back) - offering "Put back" would do nothing. Ids are compared with
 * their original types (1 is not "1"). Entries from totes that no longer
 * exist always stay, so they can be put into another tote.
 */
export function visibleRemovedEntries(entries, totes) {
  const byId = new Map(
    (Array.isArray(totes) ? totes : []).map((t) => [t?.id, t])
  );
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || !entry.item) return false;
    const home = byId.get(entry.toteId);
    if (!home || !Array.isArray(home.items)) return true;
    return !home.items.some((it) => it && it.id === entry.item.id);
  });
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
