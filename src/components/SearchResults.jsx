import { MapPin, Package, SearchX } from "lucide-react";
import { WALLS, describeSpot } from "../utils/constants";
import { itemQty } from "../utils/itemOps";
import { highlightMatches, snippetAround } from "../utils/search";

const MATCH_LABEL = { note: "Note", notes: "Tote note", tag: "Tag" };

/** Text with the words that matched the query in bold. */
function Highlighted({ text, query }) {
  return highlightMatches(text, query).map((seg, i) =>
    seg.match ? (
      <strong key={i} className="font-extrabold">
        {seg.text}
      </strong>
    ) : (
      <span key={i}>{seg.text}</span>
    )
  );
}

/**
 * Search results as a tappable list. Tapping a row opens the tote (an item
 * row also tells the tote page which item matched); "Show me" jumps to the
 * right wall and highlights the exact slot.
 */
export default function SearchResults({
  results,
  query,
  walls = WALLS,
  onOpenTote,
  onShowMe,
}) {
  if (results.length === 0) {
    return (
      <div className="apple-card flex flex-col items-center gap-2 p-8 text-center text-gray-500 dark:text-gray-400">
        <SearchX className="h-8 w-8 text-gray-300 dark:text-gray-600" aria-hidden="true" />
        <p className="font-semibold text-gray-600 dark:text-gray-400">
          Nothing matching “{query}”
        </p>
        <p className="text-sm">
          Try a shorter word — search forgives typos and plurals.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Search results">
      {results.map((result) => {
        const { tote, item, type } = result;
        const path = describeSpot(tote.position, walls);
        const qty = type === "item" ? itemQty(item) : 1;
        const key = `${tote.id}-${type === "item" ? item.id : "tote"}`;
        return (
          <li key={key} className="apple-card overflow-hidden">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() =>
                  type === "item"
                    ? onOpenTote(tote, { itemId: item.id })
                    : onOpenTote(tote)
                }
                className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 p-3 text-left"
              >
                {type === "item" && item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                    <Package className="h-6 w-6 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 font-semibold text-gray-900 dark:text-gray-100">
                    <span className="min-w-0 truncate">
                      <Highlighted
                        text={type === "item" ? item.name : tote.name}
                        query={query}
                      />
                    </span>
                    {type === "item" && qty === 0 && (
                      <span className="shrink-0 text-sm font-normal text-amber-700 dark:text-amber-400">
                        out of stock
                      </span>
                    )}
                    {type === "item" && qty > 1 && (
                      <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                        × {qty}
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-gray-500 dark:text-gray-400">
                    {type === "item" ? `${tote.name} · ${path}` : path}
                  </span>
                  {result.match && (
                    <span
                      className="mt-0.5 block truncate text-sm text-gray-600 dark:text-gray-300"
                      data-testid="match-snippet"
                    >
                      <span className="text-gray-500 dark:text-gray-400">
                        {MATCH_LABEL[result.match.field] || "Match"}:{" "}
                      </span>
                      <Highlighted
                        text={snippetAround(result.match.text, query)}
                        query={query}
                      />
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onShowMe(tote.position)}
                className="mr-2 flex min-h-[48px] shrink-0 items-center gap-1 rounded-xl bg-blue-50 px-3 text-sm font-semibold text-blue-600 dark:bg-blue-950 dark:text-blue-400"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Show me
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

