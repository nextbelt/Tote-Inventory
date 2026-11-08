import { useEffect, useMemo, useState } from "react";
import { useTotes } from "../hooks/useTotes";
import { describeSpot } from "../utils/constants";
import { adjustQty, itemQty } from "../utils/itemOps";
import { parseItems } from "../utils/parseItems";
import { findSimilarItems } from "../utils/search";
import { useToast } from "./Toast";

const DEBOUNCE_MS = 250;
const MAX_NAMES = 5;
const EMPTY = [];

/** `value`, but only after it stopped changing for a moment. */
function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * "You already have Bungee cords - 3 in Camping (Front wall ...)" under an
 * add box. Looks at what is typed (a list is split like Add would), at the
 * visible totes except `excludeToteId`, and offers "+1 there" (an
 * adjust-quantity op on that tote) and, when `onOpenTote` is given, "Open".
 * Informational only: it never blocks typing or adding.
 */
export default function DuplicateHint({ text, excludeToteId, onOpenTote }) {
  const { totesByPosition, walls, updateItems } = useTotes();
  const toast = useToast();
  const [busy, setBusy] = useState(() => new Set());
  const settled = useDebounced(text, DEBOUNCE_MS);

  const visibleTotes = useMemo(
    () => Object.values(totesByPosition || {}),
    [totesByPosition]
  );

  const groups = useMemo(() => {
    if (!settled || !settled.trim()) return EMPTY;
    const seen = new Set();
    const out = [];
    for (const { name } of parseItems(settled).items) {
      const matches = findSimilarItems(visibleTotes, name, {
        excludeToteId,
        limit: 2,
      });
      if (matches.length === 0) continue;
      // The same match can come from two typed names ("cord, cords")
      const fresh = matches.filter(({ tote, item }) => {
        const key = `${tote.id}\u0000${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length > 0) out.push(fresh);
      if (out.length >= MAX_NAMES) break;
    }
    return out;
  }, [settled, visibleTotes, excludeToteId]);

  // Hide the instant the box is emptied (the debounce only delays showing)
  if (!text || !text.trim() || groups.length === 0) return null;

  const compact = groups.length > 1;
  const busyKey = (tote, item) => `${tote.id}\u0000${item.id}`;

  const addOneThere = async (tote, item) => {
    const key = busyKey(tote, item);
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    try {
      await updateItems(tote.id, adjustQty(item.id, 1));
      toast.show(`Added 1 more “${item.name}” in ${tote.name}`, {
        actionLabel: "Undo",
        onAction: () =>
          updateItems(tote.id, adjustQty(item.id, -1)).catch((err) =>
            toast.error(err.message)
          ),
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const buttonClass =
    "flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold text-blue-600 active:bg-blue-50 disabled:opacity-40 dark:text-blue-400 dark:active:bg-blue-950";

  return (
    <div
      data-testid="duplicate-hint"
      className="mt-2 space-y-1 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-1 text-sm text-gray-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-gray-300"
    >
      {groups.flat().map(({ tote, item }, index) => {
        const qty = itemQty(item);
        const where = qty === 0 ? `out of stock in ${tote.name}` : `${qty} in ${tote.name}`;
        const path = describeSpot(tote.position, walls && walls.length ? walls : undefined);
        const lead = compact
          ? `${item.name} — `
          : index === 0
            ? `You already ${qty === 0 ? "track" : "have"} ${item.name} — `
            : `Also ${item.name} — `;
        return (
          <div
            key={busyKey(tote, item)}
            className="flex flex-wrap items-center justify-between gap-x-2"
          >
            <p className="min-w-0 flex-1 basis-48 py-1.5 break-words">
              {lead}
              {where}
              {compact ? "" : ` (${path})`}
            </p>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => addOneThere(tote, item)}
                disabled={busy.has(busyKey(tote, item))}
                className={buttonClass}
              >
                +1 there
                <span className="sr-only"> for {item.name} in {tote.name}</span>
              </button>
              {onOpenTote && (
                <button
                  type="button"
                  onClick={() => onOpenTote(tote, { itemId: item.id })}
                  className={buttonClass}
                >
                  Open
                  <span className="sr-only"> {tote.name}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
