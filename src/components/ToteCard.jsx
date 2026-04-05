import { Plus } from "lucide-react";

export default function ToteCard({ position, tote, onClick }) {
  const hasItems = tote && tote.items && tote.items.length > 0;
  const itemCount = hasItems ? tote.items.length : 0;

  return (
    <div className="flex flex-col items-center p-1 sm:p-2">
      <div className="text-xs font-semibold text-blue-600 mb-1 sm:mb-2">
        {position}
      </div>
      <div
        onClick={onClick}
        className="relative cursor-pointer transform hover:scale-110 transition-all duration-300 hover:shadow-2xl group"
      >
        <div className="relative">
          {/* Hover glow backdrop */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-400 rounded-lg opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-200" />

          {/* Lid */}
          <div className="relative w-8 h-2 sm:w-12 sm:h-2.5 md:w-16 md:h-3 bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded-t-lg border border-gray-400/30 shadow-lg backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent rounded-t-lg" />
            <div className="absolute left-1 sm:left-1.5 md:left-2 top-0.5 w-1.5 sm:w-2 md:w-3 h-1 md:h-1.5 bg-gray-500/60 rounded-sm" />
            <div className="absolute right-1 sm:right-1.5 md:right-2 top-0.5 w-1.5 sm:w-2 md:w-3 h-1 md:h-1.5 bg-gray-500/60 rounded-sm" />
          </div>

          {/* Body */}
          <div
            className={`relative w-8 h-8 sm:w-12 sm:h-10 md:w-16 md:h-12 bg-gradient-to-br backdrop-blur-xl border shadow-xl transition-all duration-300 ${
              hasItems
                ? "from-blue-700/90 via-blue-800/90 to-blue-900/90 border-blue-500/50 shadow-blue-500/30"
                : "from-gray-700/90 via-gray-800/90 to-gray-900/90 border-gray-600/30"
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />

            {/* Item count badge */}
            {hasItems && (
              <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center z-20">
                <span className="text-white text-xs font-bold">
                  {itemCount}
                </span>
              </div>
            )}

            {/* Fullness indicator bars */}
            {hasItems && (
              <div className="absolute bottom-1 left-1 right-1 flex gap-0.5 z-[15]">
                {Array.from({ length: Math.min(itemCount, 4) }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-0.5 sm:h-1 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full opacity-80"
                  />
                ))}
                {itemCount > 4 && (
                  <div className="w-1 h-0.5 sm:h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
                )}
              </div>
            )}

            {/* Vertical ridges */}
            <div className="absolute left-0.5 sm:left-1 top-0 h-full w-px bg-gradient-to-b from-gray-500/40 to-gray-700/40" />
            <div className="absolute left-1.5 sm:left-3 top-0 h-full w-px bg-gradient-to-b from-gray-500/30 to-gray-700/30" />
            <div className="absolute right-1.5 sm:right-3 top-0 h-full w-px bg-gradient-to-b from-gray-500/30 to-gray-700/30" />
            <div className="absolute right-0.5 sm:right-1 top-0 h-full w-px bg-gradient-to-b from-gray-500/40 to-gray-700/40" />

            {/* Centre content */}
            {tote ? (
              <div className="absolute inset-0.5 sm:inset-1 flex flex-col justify-center items-center text-white text-xs overflow-hidden z-10">
                <div className="font-bold text-center text-xs leading-tight truncate w-full px-0.5 sm:px-1">
                  {tote.name.length > 4
                    ? tote.name.substring(0, 4) + "…"
                    : tote.name}
                </div>
                {hasItems && (
                  <div className="text-blue-600 text-xs font-bold mt-0.5 bg-blue-100 px-1 rounded">
                    {itemCount} items
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <Plus className="w-2 h-2 sm:w-3 sm:h-3 md:w-4 md:h-4 text-white opacity-60 group-hover:opacity-100 transition-opacity duration-200" />
              </div>
            )}
          </div>

          {/* Bottom rim */}
          <div className="w-8 sm:w-12 md:w-16 h-0.5 sm:h-1 bg-gradient-to-r from-gray-700 via-gray-800 to-gray-700 rounded-b-sm shadow-lg" />

          {/* Hover glow overlay */}
          <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500/0 via-blue-600/0 to-indigo-500/0 group-hover:from-blue-500/20 group-hover:via-blue-600/20 group-hover:to-indigo-500/20 transition-all duration-200 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
