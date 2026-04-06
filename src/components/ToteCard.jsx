import { Plus } from "lucide-react";

export default function ToteCard({ position, tote, onClick }) {
  const hasItems = tote && tote.items && tote.items.length > 0;
  const itemCount = hasItems ? tote.items.length : 0;

  return (
    <div className="flex flex-col items-center p-1 sm:p-2">
      <div className="text-xs font-semibold text-gray-700 mb-1 sm:mb-2">
        {position}
      </div>
      <div
        onClick={onClick}
        className="relative cursor-pointer transform hover:scale-110 transition-all duration-300 hover:shadow-2xl group"
      >
        <div className="relative">
          {/* Hover glow backdrop */}
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-400 rounded-lg opacity-0 group-hover:opacity-25 blur-xl transition-opacity duration-200" />

          {/* Lid — yellow */}
          <div className="relative w-14 h-2 sm:w-20 sm:h-2.5 md:w-28 md:h-3 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500 rounded-t-lg border border-yellow-600/40 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-t-lg" />
            {/* Lid latches */}
            <div className="absolute left-1.5 sm:left-2 md:left-3 top-0.5 w-2 sm:w-3 md:w-4 h-1 md:h-1.5 bg-yellow-700/50 rounded-sm" />
            <div className="absolute right-1.5 sm:right-2 md:right-3 top-0.5 w-2 sm:w-3 md:w-4 h-1 md:h-1.5 bg-yellow-700/50 rounded-sm" />
          </div>

          {/* Body — black */}
          <div className="relative w-14 h-6 sm:w-20 sm:h-8 md:w-28 md:h-10 bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-gray-700/60 shadow-xl transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />

            {/* Item count badge */}
            {hasItems && (
              <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center z-20">
                <span className="text-gray-900 text-xs font-bold">
                  {itemCount}
                </span>
              </div>
            )}

            {/* Fullness indicator bars — yellow for occupied */}
            {hasItems && (
              <div className="absolute bottom-1 left-1 right-1 flex gap-0.5 z-[15]">
                {Array.from({ length: Math.min(itemCount, 4) }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-0.5 sm:h-1 bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full opacity-90"
                  />
                ))}
                {itemCount > 4 && (
                  <div className="w-1 h-0.5 sm:h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
                )}
              </div>
            )}

            {/* Empty tote indicator — dashed outline inside */}
            {tote && !hasItems && (
              <div className="absolute inset-1 sm:inset-1.5 border border-dashed border-gray-600 rounded-sm" />
            )}

            {/* Vertical ridges */}
            <div className="absolute left-0.5 sm:left-1 top-0 h-full w-px bg-gradient-to-b from-gray-600/40 to-gray-800/40" />
            <div className="absolute left-1.5 sm:left-3 top-0 h-full w-px bg-gradient-to-b from-gray-600/30 to-gray-800/30" />
            <div className="absolute right-1.5 sm:right-3 top-0 h-full w-px bg-gradient-to-b from-gray-600/30 to-gray-800/30" />
            <div className="absolute right-0.5 sm:right-1 top-0 h-full w-px bg-gradient-to-b from-gray-600/40 to-gray-800/40" />

            {/* Centre content */}
            {tote ? (
              <div className="absolute inset-0.5 sm:inset-1 flex flex-col justify-center items-center text-xs overflow-hidden z-10">
                <div className="font-bold text-center text-xs leading-tight truncate w-full px-0.5 sm:px-1 text-yellow-300">
                  {tote.name.length > 8
                    ? tote.name.substring(0, 8) + "…"
                    : tote.name}
                </div>
                {hasItems ? (
                  <div className="text-gray-900 text-xs font-bold mt-0.5 bg-yellow-400 px-1 rounded">
                    {itemCount} items
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs italic mt-0.5">
                    empty
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <Plus className="w-2 h-2 sm:w-3 sm:h-3 md:w-4 md:h-4 text-gray-500 opacity-60 group-hover:text-yellow-400 group-hover:opacity-100 transition-all duration-200" />
              </div>
            )}
          </div>

          {/* Bottom rim — black */}
          <div className="w-14 sm:w-20 md:w-28 h-0.5 sm:h-1 bg-gradient-to-r from-gray-800 via-black to-gray-800 rounded-b-sm shadow-lg" />

          {/* Hover glow overlay — yellow tint */}
          <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-yellow-400/0 via-amber-400/0 to-yellow-400/0 group-hover:from-yellow-400/10 group-hover:via-amber-400/15 group-hover:to-yellow-400/10 transition-all duration-200 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
