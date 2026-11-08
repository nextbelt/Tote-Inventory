import { Clock, CloudOff, HardDrive, Package, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import WallPanel, { MiniMap } from "../components/GarageWalls";
import RestockSheet from "../components/RestockSheet";
import SearchBar from "../components/SearchBar";
import SearchResults from "../components/SearchResults";
import ShelfEditor from "../components/ShelfEditor";
import ThemeToggle from "../components/ThemeToggle";
import TidyUpBanner from "../components/TidyUpBanner";
import { useTotes } from "../hooks/useTotes";
import { getWallIdForPosition } from "../utils/constants";
import { restockItems } from "../utils/insights";
import { searchTotes } from "../utils/search";
import RelativeTime from "../components/RelativeTime";
import { latestModified, toteModifiedDate } from "../utils/time";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function GridPage({
  onSelectTote,
  searchTerm,
  onSearchChange,
  mode,
  onModeChange,
  initialScrollY = 0,
  onAddTote,
  activeWallId,
  onWallChange,
  highlightPosition,
  onClearHighlight,
}) {
  const {
    totes,
    totesByPosition,
    loading,
    refreshing,
    source,
    walls,
    totalPositions,
    loadData,
  } = useTotes();
  const [editWall, setEditWall] = useState(null); // "left" | "right" | null
  const [restockOpen, setRestockOpen] = useState(false);
  const carouselRef = useRef(null);
  const scrollDebounceRef = useRef(null);

  const activeIndex = Math.max(
    0,
    walls.findIndex((w) => w.id === activeWallId)
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

  // Back from a tote: put the page back where it was (results list, tote
  // list, or garage). Runs once, as soon as there is content to scroll.
  const scrollRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (scrollRestoredRef.current || loading) return;
    scrollRestoredRef.current = true;
    if (initialScrollY > 0) window.scrollTo(0, initialScrollY);
  }, [loading, initialScrollY]);

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
      const wall = walls[Math.min(walls.length - 1, Math.max(0, index))];
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
    onSearchChange("");
    onModeChange("garage");
    const wallId = getWallIdForPosition(position);
    if (wallId) onWallChange(wallId, position);
  };

  const results = searchTerm.trim() ? searchTotes(totes, searchTerm) : null;
  const occupied = Object.keys(totesByPosition).length;
  const restockCount = useMemo(
    () => restockItems(Object.values(totesByPosition)).length,
    [totesByPosition]
  );
  const lastUpdated = latestModified(totes);
  const sortedTotes = [...totes].sort((a, b) =>
    a.position.localeCompare(b.position, undefined, { numeric: true })
  );

  return (
    <div className="min-h-[100dvh] pb-8" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}>
      {/* Sticky header */}
      <header
        className="sticky top-0 z-30 border-b border-white/40 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80"
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
            <div className="flex items-center gap-1">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                {occupied}/{totalPositions} spots
              </span>
              {restockCount > 0 && (
                <button
                  type="button"
                  onClick={() => setRestockOpen(true)}
                  className="flex min-h-[44px] shrink-0 items-center rounded-xl px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                >
                  Restock
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 dark:bg-amber-950">
                    {restockCount}
                  </span>
                </button>
              )}
              <ThemeToggle />
              <button
                type="button"
                onClick={() => loadData()}
                disabled={refreshing}
                aria-label="Refresh"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-blue-600 disabled:opacity-50 dark:text-blue-400"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <SearchBar value={searchTerm} onChange={onSearchChange} />
          {lastUpdated && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Last updated</span>
              <RelativeTime date={lastUpdated} />
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-3 sm:px-4">
        {/* Connection status */}
        {source === "cache" && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Offline — showing the last saved copy. Changes can&apos;t be saved
            right now.
          </div>
        )}
        {source === "local" && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
            <HardDrive className="h-4 w-4 shrink-0" aria-hidden="true" />
            Saved on this device only (cloud sync not set up).
          </div>
        )}
        <TidyUpBanner />

        {/* Search results replace the garage while typing */}
        {results ? (
          <SearchResults
            results={results}
            query={searchTerm}
            walls={walls}
            onOpenTote={onSelectTote}
            onShowMe={handleShowMe}
          />
        ) : loading ? (
          <div className="space-y-3" aria-label="Loading totes">
            <div className="h-11 animate-pulse rounded-xl bg-white/60 dark:bg-gray-800/60" />
            <div className="h-72 animate-pulse rounded-xl bg-white/60 dark:bg-gray-800/60" />
            <div className="h-24 animate-pulse rounded-xl bg-white/60 dark:bg-gray-800/60" />
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div className="mb-2 flex rounded-xl bg-gray-200/70 p-1 dark:bg-gray-800/70">
              {[
                ["garage", "Garage"],
                ["list", "All totes"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onModeChange(value)}
                  aria-pressed={mode === value}
                  className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold transition-colors ${
                    mode === value
                      ? "bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300"
                      : "text-gray-600 dark:text-gray-400"
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
                    className="flex flex-1 rounded-xl bg-gray-200/70 p-1 dark:bg-gray-800/70"
                    role="group"
                    aria-label="Choose a wall"
                  >
                    {walls.map((wall) => (
                      <button
                        key={wall.id}
                        type="button"
                        onClick={() => onWallChange(wall.id)}
                        aria-pressed={wall.id === activeWallId}
                        className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold transition-colors ${
                          wall.id === activeWallId
                            ? "bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300"
                            : "text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {wall.shortLabel}
                      </button>
                    ))}
                  </div>
                  <MiniMap activeWallId={activeWallId} />
                </div>

                {totes.length === 0 && (
                  <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                    Your garage is empty — tap any slot to add your first tote.
                  </div>
                )}

                {/* Swipeable walls */}
                <div
                  ref={carouselRef}
                  onScroll={handleCarouselScroll}
                  className="wall-carousel -mx-3 sm:mx-0"
                >
                  {walls.map((wall) => (
                    <div key={wall.id} className="wall-panel px-3 sm:px-0">
                      <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {wall.label}
                      </p>
                      <WallPanel
                        wall={wall}
                        totesByPosition={totesByPosition}
                        onSlotClick={handleSlotClick}
                        highlightPosition={highlightPosition}
                      />
                      {wall.id !== "front" && (
                        <div className="mt-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setEditWall(wall.id)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-blue-600 dark:text-blue-400"
                          >
                            <Wrench className="h-4 w-4" aria-hidden="true" />
                            Edit shelves
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
                  Swipe or use the tabs to change walls · Tap a tote to open it
                  · Tap an empty slot to add one
                </p>
              </>
            )}

            {mode === "list" &&
              (sortedTotes.length === 0 ? (
                <div className="apple-card p-8 text-center text-gray-500 dark:text-gray-400">
                  No totes yet — switch to Garage and tap an empty slot.
                </div>
              ) : (
                <ul className="space-y-2" aria-label="All totes">
                  {sortedTotes.map((tote) => {
                    const count = Array.isArray(tote.items)
                      ? tote.items.length
                      : 0;
                    const modified = toteModifiedDate(tote);
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
                            {modified && (
                              <span className="block text-xs text-gray-500 dark:text-gray-400">
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
              ))}
          </>
        )}
      </main>

      {restockOpen && (
        <RestockSheet
          onClose={() => setRestockOpen(false)}
          onSelectTote={onSelectTote}
        />
      )}

      {editWall && (
        <ShelfEditor wallId={editWall} onClose={() => setEditWall(null)} />
      )}
    </div>
  );
}
