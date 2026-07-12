import { CloudOff, HardDrive, Package, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import WallPanel, { MiniMap } from "../components/GarageWalls";
import SearchBar from "../components/SearchBar";
import SearchResults from "../components/SearchResults";
import { useTotes } from "../hooks/useTotes";
import { TOTAL_POSITIONS, WALLS } from "../utils/constants";
import { searchTotes } from "../utils/search";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function GridPage({
  onSelectTote,
  onAddTote,
  activeWallId,
  onWallChange,
  highlightPosition,
  onClearHighlight,
}) {
  const { totes, totesByPosition, loading, refreshing, source, loadData } =
    useTotes();
  const [searchTerm, setSearchTerm] = useState("");
  const [mode, setMode] = useState("garage"); // "garage" | "list"
  const carouselRef = useRef(null);
  const scrollDebounceRef = useRef(null);

  const activeIndex = Math.max(
    0,
    WALLS.findIndex((w) => w.id === activeWallId)
  );

  const scrollToWall = useCallback((index, smooth) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({
      left: index * el.clientWidth,
      behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
    });
  }, []);

  const searchActive = Boolean(searchTerm.trim());

  // Whenever the carousel (re)appears, land on the active wall instantly
  useLayoutEffect(() => {
    scrollToWall(activeIndex, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, searchActive, loading]);

  // Keep carousel in sync when the active wall changes (tabs / "Show me")
  useEffect(() => {
    scrollToWall(activeIndex, true);
  }, [activeIndex, scrollToWall]);

  // Swipe → update the active tab once scrolling settles
  const handleCarouselScroll = () => {
    clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = setTimeout(() => {
      const el = carouselRef.current;
      if (!el || el.clientWidth === 0) return;
      const index = Math.round(el.scrollLeft / el.clientWidth);
      const wall = WALLS[Math.min(WALLS.length - 1, Math.max(0, index))];
      if (wall && wall.id !== activeWallId) onWallChange(wall.id);
    }, 80);
  };

  // "Show me": scroll the highlighted slot into view, then let the pulse fade
  useEffect(() => {
    if (!highlightPosition) return undefined;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`slot-${highlightPosition}`)
        ?.scrollIntoView({
          block: "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
    });
    const timer = setTimeout(onClearHighlight, 6000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [highlightPosition, onClearHighlight]);

  const handleSlotClick = (position) => {
    // Uses the unfiltered position map — a slot that looks empty because of
    // an active search must never allow a duplicate tote.
    const tote = totesByPosition[position];
    if (tote) onSelectTote(tote);
    else onAddTote(position);
  };

  const handleShowMe = (position) => {
    setSearchTerm("");
    setMode("garage");
    const wall = WALLS.find((w) =>
      w.fixtures.some((f) =>
        (f.slots || f.rows?.flat() || []).includes(position)
      )
    );
    if (wall) onWallChange(wall.id, position);
  };

  const results = searchTerm.trim() ? searchTotes(totes, searchTerm) : null;
  const occupied = Object.keys(totesByPosition).length;
  const sortedTotes = [...totes].sort((a, b) =>
    a.position.localeCompare(b.position, undefined, { numeric: true })
  );

  return (
    <div className="min-h-[100dvh] pb-8" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}>
      {/* Sticky header */}
      <header
        className="sticky top-0 z-30 border-b border-white/40 bg-white/80 backdrop-blur-xl"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h1 className="apple-title flex items-center gap-2 text-xl sm:text-2xl">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500">
                <Package className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              Garage Totes
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                {occupied}/{TOTAL_POSITIONS} spots
              </span>
              <button
                type="button"
                onClick={() => loadData()}
                disabled={refreshing}
                aria-label="Refresh"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-blue-600 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <SearchBar value={searchTerm} onChange={setSearchTerm} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-3 sm:px-4">
        {/* Connection status */}
        {source === "cache" && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Offline — showing the last saved copy. Changes can&apos;t be saved
            right now.
          </div>
        )}
        {source === "local" && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <HardDrive className="h-4 w-4 shrink-0" aria-hidden="true" />
            Saved on this device only (cloud sync not set up).
          </div>
        )}

        {/* Search results replace the garage while typing */}
        {results ? (
          <SearchResults
            results={results}
            query={searchTerm}
            onOpenTote={(tote) => onSelectTote(tote)}
            onShowMe={handleShowMe}
          />
        ) : loading ? (
          <div className="space-y-3" aria-label="Loading totes">
            <div className="h-11 animate-pulse rounded-xl bg-white/60" />
            <div className="h-72 animate-pulse rounded-xl bg-white/60" />
            <div className="h-24 animate-pulse rounded-xl bg-white/60" />
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div className="mb-2 flex rounded-xl bg-gray-200/70 p-1">
              {[
                ["garage", "Garage"],
                ["list", "All totes"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold transition-colors ${
                    mode === value
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "garage" && (
              <>
                {/* Wall tabs + orientation */}
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className="flex flex-1 rounded-xl bg-gray-200/70 p-1"
                    role="group"
                    aria-label="Choose a wall"
                  >
                    {WALLS.map((wall) => (
                      <button
                        key={wall.id}
                        type="button"
                        onClick={() => onWallChange(wall.id)}
                        aria-pressed={wall.id === activeWallId}
                        className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold transition-colors ${
                          wall.id === activeWallId
                            ? "bg-white text-blue-600 shadow-sm"
                            : "text-gray-600"
                        }`}
                      >
                        {wall.shortLabel}
                      </button>
                    ))}
                  </div>
                  <MiniMap activeWallId={activeWallId} />
                </div>

                {totes.length === 0 && (
                  <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    Your garage is empty — tap any slot to add your first tote.
                  </div>
                )}

                {/* Swipeable walls */}
                <div
                  ref={carouselRef}
                  onScroll={handleCarouselScroll}
                  className="wall-carousel -mx-3 sm:mx-0"
                >
                  {WALLS.map((wall) => (
                    <div key={wall.id} className="wall-panel px-3 sm:px-0">
                      <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {wall.label}
                      </p>
                      <WallPanel
                        wall={wall}
                        totesByPosition={totesByPosition}
                        onSlotClick={handleSlotClick}
                        highlightPosition={highlightPosition}
                      />
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-center text-xs text-gray-500">
                  Swipe or use the tabs to change walls · Tap a tote to open it
                  · Tap an empty slot to add one
                </p>
              </>
            )}

            {mode === "list" &&
              (sortedTotes.length === 0 ? (
                <div className="apple-card p-8 text-center text-gray-500">
                  No totes yet — switch to Garage and tap an empty slot.
                </div>
              ) : (
                <ul className="space-y-2" aria-label="All totes">
                  {sortedTotes.map((tote) => {
                    const count = Array.isArray(tote.items)
                      ? tote.items.length
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
                          <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                            {tote.name}
                          </span>
                          <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                            {count} item{count === 1 ? "" : "s"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </>
        )}
      </main>
    </div>
  );
}
