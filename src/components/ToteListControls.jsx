import { PackageX, X } from "lucide-react";
import { tagColor } from "../utils/tagColors";
import { SORT_OPTIONS, tagKey } from "../utils/toteList";

// The tap target is the whole 44 px button; the visible pill inside is slimmer
// so a row of filters does not take over the screen.
function FilterChip({ pressed, onClick, children, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="inline-flex min-h-[44px] items-center"
    >
      <span
        className={`list-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
          pressed ? "ring-2 ring-blue-600 dark:ring-blue-400" : ""
        } ${className}`}
      >
        {children}
      </span>
    </button>
  );
}

const IDLE_CHIP =
  "border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/**
 * Sort + filter controls for the All totes list. Purely presentational: the
 * parent owns the state (and remembers it for the session).
 *
 * allTags: [{ key, label, count }] — only passed when the database has tags.
 */
export default function ToteListControls({
  prefs,
  onChange,
  allTags = [],
  showTags = false,
  filtersActive = false,
  onClear,
}) {
  const selected = new Set(prefs.tags.map(tagKey));
  const toggleTag = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Store the labels so they survive a reload of the page
    onChange({
      tags: allTags.filter((t) => next.has(t.key)).map((t) => t.label),
    });
  };

  return (
    <div className="mb-3 space-y-1" data-testid="list-controls">
      <div
        className="flex rounded-xl bg-gray-200/70 p-1 dark:bg-gray-800/70"
        role="group"
        aria-label="Sort totes by"
      >
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange({ sort: option.value })}
            aria-pressed={prefs.sort === option.value}
            className={`min-h-[44px] flex-1 rounded-lg px-1 text-sm font-semibold transition-colors ${
              prefs.sort === option.value
                ? "bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-2"
        role="group"
        aria-label="Filter totes"
      >
        <FilterChip
          pressed={prefs.outOfStock}
          onClick={() => onChange({ outOfStock: !prefs.outOfStock })}
          className={
            prefs.outOfStock
              ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200"
              : IDLE_CHIP
          }
        >
          <PackageX className="h-4 w-4" aria-hidden="true" />
          Out of stock
        </FilterChip>

        {showTags &&
          allTags.map((tag) => (
            <FilterChip
              key={tag.key}
              pressed={selected.has(tag.key)}
              onClick={() => toggleTag(tag.key)}
              className={
                selected.has(tag.key)
                  ? `border-transparent ${tagColor(tag.label).chip}`
                  : IDLE_CHIP
              }
            >
              {tag.label}
              <span className="text-xs font-normal opacity-80">{tag.count}</span>
            </FilterChip>
          ))}

        {filtersActive && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-2 text-sm font-semibold text-blue-700 dark:text-blue-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
