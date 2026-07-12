import { MapPin, Package, SearchX } from "lucide-react";
import { describePosition } from "../utils/constants";

function itemQty(item) {
  const q = Number(item?.qty);
  return Number.isFinite(q) ? q : 1;
}

/**
 * Search results as a tappable list. Tapping a row opens the tote;
 * "Show me" jumps to the right wall and highlights the exact slot.
 */
export default function SearchResults({ results, query, onOpenTote, onShowMe }) {
  if (results.length === 0) {
    return (
      <div className="apple-card flex flex-col items-center gap-2 p-8 text-center text-gray-500">
        <SearchX className="h-8 w-8 text-gray-300" aria-hidden="true" />
        <p className="font-semibold text-gray-600">
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
        const { path } = describePosition(tote.position);
        const key = `${tote.id}-${type === "item" ? item.id : "tote"}`;
        return (
          <li key={key} className="apple-card overflow-hidden">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => onOpenTote(tote)}
                className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 p-3 text-left"
              >
                {type === "item" && item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <Package className="h-6 w-6 text-gray-400" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-gray-900">
                    {type === "item" ? item.name : tote.name}
                    {type === "item" && itemQty(item) !== 1 && (
                      <span className="ml-1.5 text-sm font-normal text-gray-500">
                        × {itemQty(item)}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-gray-500">
                    {type === "item" ? `${tote.name} · ${path}` : path}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onShowMe(tote.position)}
                className="mr-2 flex min-h-[48px] shrink-0 items-center gap-1 rounded-xl bg-blue-50 px-3 text-sm font-semibold text-blue-600"
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
