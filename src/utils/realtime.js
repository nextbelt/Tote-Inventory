// Applying a Supabase realtime payload to the in-memory tote list.
//
// NOT wired yet: useTotes reloads on every realtime event today. Whoever
// switches to patching state from payloads must use this helper, because
// several app records now live in the SAME table as hidden "__" rows:
//
//   - a soft delete is an UPDATE that moves the row to "__deleted__:…"
//   - swap_tote_positions() emits an intermediate UPDATE to "__swap__:…"
//   - the layout settings and removed-items bin rows are INSERT/UPDATEs
//
// An INSERT or UPDATE whose new position is reserved therefore means
// "this row is not a tote (any more)" and removes it from the walls; it
// never adds one.

import { isReservedPosition } from "./reservedRows";

const asArray = (list) => (Array.isArray(list) ? list : []);

/**
 * @param {object[]} totes   current real totes (no reserved rows)
 * @param {{ eventType: "INSERT"|"UPDATE"|"DELETE", new?: object, old?: object }} payload
 * @returns {object[]} the next list (same reference when nothing changed)
 */
export function applyRealtimeChange(totes, payload) {
  const list = asArray(totes);
  const type = payload?.eventType;

  if (type === "DELETE") {
    const id = payload?.old?.id;
    if (id === undefined || id === null) return list;
    return list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list;
  }

  if (type === "INSERT" || type === "UPDATE") {
    const row = payload?.new;
    if (!row || row.id === undefined || row.id === null) return list;
    if (isReservedPosition(row.position)) {
      // Soft-deleted, mid-swap, settings or bin row → never on a wall
      return list.some((t) => t.id === row.id) ? list.filter((t) => t.id !== row.id) : list;
    }
    const idx = list.findIndex((t) => t.id === row.id);
    if (idx < 0) return [...list, row];
    const next = [...list];
    next[idx] = row;
    return next;
  }

  return list;
}
