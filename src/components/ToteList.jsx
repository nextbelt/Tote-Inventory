import { useCallback, useMemo, useState } from "react";
import { useTotes } from "../hooks/useTotes";
import { tagColor } from "../utils/tagColors";
import { toteModifiedDate } from "../utils/time";
import {
  collectTags,
  filterTotes,
  hasOutOfStock,
  listableTotes,
  loadListPrefs,
  saveListPrefs,
  sortTotes,
  tagKey,
  toteTags,
} from "../utils/toteList";
import { itemQty } from "../utils/itemOps";
import RelativeTime from "./RelativeTime";
import ToteListControls from "./ToteListControls";

const MAX_TAGS_IN_ROW = 2;

/**
 * The "All totes" list with sort and filters. The choice is remembered for
 * the browser session (sessionStorage), so coming Back from a tote lands on
 * the same view; if storage is blocked it simply lasts while the page is open.
 */
export default function ToteList({ totes, onSelectTote }) {
  const { capabilities } = useTotes();
  const tagsEnabled = Boolean(capabilities?.tags);
  const [prefs, setPrefs] = useState(loadListPrefs);

  const update = useCallback((patch) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      saveListPrefs(next);
      return next;
    });
  }, []);

  const clearFilters = useCallback(
    () => update({ tags: [], outOfStock: false }),
    [update]
  );

  const listable = useMemo(() => listableTotes(totes), [totes]);
  const allTags = useMemo(
    () => (tagsEnabled ? collectTags(listable) : []),
    [listable, tagsEnabled]
  );

  // A remembered tag that no tote has any more must not silently empty the
  // list with no chip to switch it off.
  const activeTags = useMemo(() => {
    const known = new Set(allTags.map((t) => t.key));
    return prefs.tags.filter((t) => known.has(tagKey(t)));
  }, [allTags, prefs.tags]);
  const effectivePrefs = { ...prefs, tags: activeTags };
  const filtersActive =
    effectivePrefs.outOfStock || (tagsEnabled && activeTags.length > 0);

  const rows = useMemo(
    () =>
      sortTotes(
        filterTotes(listable, effectivePrefs, tagsEnabled),
        prefs.sort
      ),
    // effectivePrefs is rebuilt every render; depend on its parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listable, activeTags, prefs.outOfStock, prefs.sort, tagsEnabled]
  );

  if (listable.length === 0) {
    return (
      <div className="apple-card p-8 text-center text-gray-600 dark:text-gray-300">
        No totes yet — switch to Garage and tap an empty slot.
      </div>
    );
  }

  return (
    <div>
      <ToteListControls
        prefs={effectivePrefs}
        onChange={update}
        allTags={allTags}
        showTags={tagsEnabled && allTags.length > 0}
        filtersActive={filtersActive}
        onClear={clearFilters}
      />

      {filtersActive && (
        <p
          className="mb-2 text-sm text-gray-600 dark:text-gray-300"
          role="status"
        >
          Showing {rows.length} of {listable.length} totes
        </p>
      )}

      {rows.length === 0 ? (
        <div className="apple-card p-6 text-center">
          <p className="text-gray-700 dark:text-gray-200">
            No totes match these filters.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="apple-button mt-3"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="All totes">
          {rows.map((tote) => {
            const items = Array.isArray(tote.items) ? tote.items : [];
            const count = items.length;
            const modified = toteModifiedDate(tote);
            const tags = tagsEnabled ? toteTags(tote) : [];
            const outCount =
              effectivePrefs.outOfStock && hasOutOfStock(tote)
                ? items.filter((item) => item && itemQty(item) === 0).length
                : 0;
            return (
              <li key={tote.id}>
                <button
                  type="button"
                  onClick={() => onSelectTote(tote)}
                  className="apple-card flex min-h-[56px] w-full items-center gap-3 p-3 text-left"
                >
                  <span className="w-11 shrink-0 rounded-lg bg-gray-900 px-2 py-1.5 text-center text-xs font-bold text-yellow-300">
                    {tote.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">
                      {tote.name}
                    </span>
                    {tags.length > 0 && (
                      <span
                        className="mt-0.5 flex flex-wrap gap-1"
                        data-testid="row-tags"
                      >
                        {tags.slice(0, MAX_TAGS_IN_ROW).map((tag) => (
                          <span
                            key={tag}
                            className={`max-w-[8rem] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagColor(tag).chip}`}
                          >
                            {tag}
                          </span>
                        ))}
                        {tags.length > MAX_TAGS_IN_ROW && (
                          <span className="py-0.5 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                            +{tags.length - MAX_TAGS_IN_ROW}
                          </span>
                        )}
                      </span>
                    )}
                    {outCount > 0 && (
                      <span className="block text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {outCount} out of stock
                      </span>
                    )}
                    {modified && (
                      <span className="block text-xs text-gray-600 dark:text-gray-400">
                        Modified <RelativeTime date={modified} />
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    {count} item{count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
