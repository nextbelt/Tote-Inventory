import { Package, Search } from "lucide-react";
import { useMemo, useState } from "react";
import Sheet from "./Sheet";
import { describePosition } from "../utils/constants";
import { toteModifiedTime } from "../utils/time";

/** The hidden layout-settings row must never be offered as a tote. */
const CONFIG_POSITION = "__config__";

/**
 * Pick one of the OTHER totes (e.g. as the destination of an item move).
 * Most recently modified first, with a filter box for long lists.
 *
 * Props:
 *   totes      – candidate totes (usually Object.values(totesByPosition))
 *   excludeId  – the current tote's id, left out of the list
 *   title      – sheet title
 *   onPick     – (tote) => void
 *   onClose    – dismiss
 */
export default function TotePicker({ totes, excludeId, title, onPick, onClose }) {
  const [filter, setFilter] = useState("");

  const candidates = useMemo(
    () =>
      (Array.isArray(totes) ? totes : [])
        .filter((t) => t && t.id !== excludeId && t.position !== CONFIG_POSITION)
        .map((t) => ({ tote: t, path: describePosition(t.position).path }))
        .sort((a, b) => toteModifiedTime(b.tote) - toteModifiedTime(a.tote)),
    [totes, excludeId]
  );

  const term = filter.trim().toLowerCase();
  const shown = term
    ? candidates.filter(
        ({ tote, path }) =>
          String(tote.name || "").toLowerCase().includes(term) ||
          path.toLowerCase().includes(term) ||
          String(tote.position || "").toLowerCase().includes(term)
      )
    : candidates;

  return (
    <Sheet title={title} onClose={onClose}>
      {candidates.length > 0 && (
        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter totes…"
            aria-label="Filter totes"
            autoComplete="off"
            className="apple-input w-full pl-10"
          />
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="py-6 text-center text-gray-500 dark:text-gray-400">
          There are no other totes yet.
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-gray-500 dark:text-gray-400">
          No totes match “{filter.trim()}”.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map(({ tote, path }) => {
            const count = Array.isArray(tote.items) ? tote.items.length : 0;
            return (
              <li key={tote.id}>
                <button
                  type="button"
                  onClick={() => onPick(tote)}
                  className="apple-card flex min-h-[56px] w-full items-center gap-3 p-3 text-left active:bg-blue-50 dark:active:bg-blue-950"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                    <Package className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">
                      {tote.name}
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                      {path}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
                    {count} item{count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
