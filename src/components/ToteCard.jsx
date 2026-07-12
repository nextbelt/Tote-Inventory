import { Plus } from "lucide-react";

function itemCountOf(tote) {
  if (!tote || !Array.isArray(tote.items)) return 0;
  return tote.items.length;
}

/**
 * A tappable tote (or empty slot) drawn as the real thing: black bin,
 * yellow lid. Rendered as a real <button> so keyboards and screen readers
 * work, with a ≥44px touch target.
 *
 * variant "compact" – small, used on the front-wall rack grid
 * variant "wide"    – full-width, used on side-wall shelves
 */
export default function ToteCard({
  position,
  tote,
  onClick,
  variant = "compact",
  highlighted = false,
}) {
  const count = itemCountOf(tote);
  const hasItems = count > 0;
  const label = tote
    ? `${position}: ${tote.name}, ${count === 1 ? "1 item" : `${count} items`}`
    : `${position}: empty slot, add a tote`;

  if (variant === "wide") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        id={`slot-${position}`}
        className={`w-full min-h-[64px] px-1 py-1 group ${
          highlighted ? "locate-highlight" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-xs font-bold text-gray-500">
            {position}
          </span>
          {tote ? (
            <span className="flex-1">
              {/* Lid */}
              <span className="block h-2.5 rounded-t-lg border border-yellow-600/40 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500" />
              {/* Body */}
              <span className="relative flex h-12 items-center justify-between border-x border-b border-gray-700/60 bg-gradient-to-br from-gray-800 via-gray-900 to-black px-3 rounded-b-sm">
                <span className="truncate text-sm font-bold text-yellow-300">
                  {tote.name}
                </span>
                <span
                  className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    hasItems
                      ? "bg-yellow-400 text-gray-900"
                      : "bg-gray-700 text-gray-300 italic"
                  }`}
                >
                  {hasItems ? `${count} item${count === 1 ? "" : "s"}` : "empty"}
                </span>
              </span>
            </span>
          ) : (
            <span className="flex h-12 flex-1 items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-400 group-active:border-blue-400 group-active:text-blue-500">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add tote
            </span>
          )}
        </div>
      </button>
    );
  }

  // ---- compact (front-wall rack) ----
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      id={`slot-${position}`}
      className={`flex w-full min-w-0 flex-col items-center px-0.5 py-1 ${
        highlighted ? "locate-highlight" : ""
      }`}
    >
      <span className="mb-0.5 text-[10px] sm:text-xs font-semibold text-gray-600">
        {position}
      </span>
      <span className="relative block w-full max-w-[7rem]">
        {/* Lid — yellow */}
        <span className="relative block h-1.5 sm:h-2.5 rounded-t border border-yellow-600/40 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500" />
        {/* Body — black */}
        <span className="relative block h-7 sm:h-9 border-x border-b border-gray-700/60 bg-gradient-to-br from-gray-800 via-gray-900 to-black">
          {hasItems && (
            <span className="absolute -right-1 -top-2 z-10 flex h-4 min-w-4 sm:h-5 sm:min-w-5 items-center justify-center rounded-full border border-white bg-gradient-to-r from-yellow-400 to-amber-500 px-0.5 text-[10px] sm:text-xs font-bold text-gray-900 shadow">
              {count}
            </span>
          )}
          {tote ? (
            <span className="absolute inset-0 flex items-center justify-center overflow-hidden px-0.5">
              <span className="truncate text-[9px] sm:text-[11px] font-bold leading-tight text-yellow-300">
                {tote.name}
              </span>
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center">
              <Plus
                className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500"
                aria-hidden="true"
              />
            </span>
          )}
          {tote && !hasItems && (
            <span className="absolute inset-0.5 rounded-sm border border-dashed border-gray-600" />
          )}
        </span>
      </span>
    </button>
  );
}
