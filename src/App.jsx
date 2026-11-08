import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider, useToast } from "./components/Toast";
import { ToteProvider, useTotes } from "./hooks/useTotes";
import DetailPage from "./pages/DetailPage";
import FormPage from "./pages/FormPage";
import GridPage from "./pages/GridPage";
import { getWallForPosition, WALLS, wallPositions } from "./utils/constants";
import {
  buildEditUrl,
  buildGridUrl,
  buildNewUrl,
  buildToteUrl,
  historyDepth,
  navState,
  parseRoute,
} from "./utils/routes";

const TOTE_GONE_MESSAGE = "That tote isn't here anymore";
const SLOT_GONE_MESSAGE = "That spot isn't in your garage";

/** Garage state (wall, search text, mode) carried by a grid route. */
function gridFromRoute(route, wallIds) {
  return {
    wall: route.wall && wallIds.includes(route.wall) ? route.wall : "front",
    q: route.q || "",
    mode: route.mode === "list" ? "list" : "garage",
  };
}

/** Screen to show for a route, from the data on hand. */
function resolveRoute(route, { totes, totesByPosition, walls }) {
  if (route.view === "tote" || route.view === "edit") {
    const tote = totes.find((t) => t.id === route.toteId);
    if (!tote) return { missing: TOTE_GONE_MESSAGE };
    return route.view === "tote"
      ? { view: "detail", tote }
      : { view: "form", editTote: tote, position: tote.position };
  }
  if (route.view === "slot" || route.view === "new") {
    // Labels are printed upper case, but a typed link may not be
    const position = [route.position, route.position.toUpperCase()].find(
      (p) => totesByPosition[p] || wallPositions(walls).includes(p)
    );
    if (!position) return { missing: SLOT_GONE_MESSAGE };
    const occupant = totesByPosition[position];
    return occupant
      ? { view: "detail", tote: occupant }
      : { view: "form", editTote: null, position };
  }
  return { view: "garage" };
}

function currentPath() {
  return window.location.pathname + window.location.search;
}

function AppShell() {
  const { totes, totesByPosition, walls, loading, source } = useTotes();
  const toast = useToast();

  // The URL the app was opened on: grid state is read from it right away,
  // tote / slot / edit / new links wait for the data (see below).
  const initialRef = useRef(null);
  if (initialRef.current === null) {
    initialRef.current = parseRoute(window.location.search);
  }
  const initialGrid = gridFromRoute(
    initialRef.current,
    WALLS.map((w) => w.id)
  );
  // A deep link still waiting for data to resolve
  const pendingRef = useRef(initialRef.current.view === "grid" ? null : initialRef.current);

  const [view, setView] = useState("garage");
  const [selectedTote, setSelectedTote] = useState(null);
  const [editingTote, setEditingTote] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState("");
  const [activeWallId, setActiveWallId] = useState(initialGrid.wall);
  const [highlightPosition, setHighlightPosition] = useState(null);
  // Search state lives here (GridPage unmounts on every view change) so Back
  // from a tote lands on the same results, mode and scroll position.
  const [searchTerm, setSearchTerm] = useState(initialGrid.q);
  const [mode, setMode] = useState(initialGrid.mode); // "garage" | "list"
  const gridScrollRef = useRef(0);
  // Which item a search result pointed at (original id value, number or string)
  const [highlightItemId, setHighlightItemId] = useState(undefined);

  // Latest values for the popstate listener and the URL writer
  const live = useRef({});
  live.current = {
    view,
    searchTerm,
    mode,
    activeWallId,
    totes,
    totesByPosition,
    walls,
  };

  // The browser would restore its own scroll offset on Back; the grid does
  // that itself (gridScrollRef) so results, mode and place always agree.
  useEffect(() => {
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      /* not supported: harmless */
    }
  }, []);

  const gridUrl = () => {
    const s = live.current;
    return buildGridUrl({ wall: s.activeWallId, q: s.searchTerm, mode: s.mode });
  };

  /** Rewrite the current entry's URL; Safari throws if it is called too often. */
  const replaceUrl = (url, depth) => {
    try {
      window.history.replaceState(
        navState(depth ?? historyDepth(window.history.state) ?? 0),
        "",
        url
      );
    } catch {
      /* the URL is a nicety, never a reason to fail */
    }
  };

  const urlFor = (target) => {
    if (target.view === "detail") return buildToteUrl("", target.tote.id);
    if (target.view === "form") {
      return target.editTote
        ? buildEditUrl("", target.editTote.id)
        : buildNewUrl("", target.position);
    }
    return buildGridUrl(target.grid || {
      wall: live.current.activeWallId,
      q: live.current.searchTerm,
      mode: live.current.mode,
    });
  };

  /** Put a screen on display (no history change). */
  const show = useCallback((target) => {
    // Remember where the garage/results page was scrolled before leaving it.
    // Only while the grid is on screen: other pages have their own scroll.
    if (live.current.view === "garage" && target.view !== "garage") {
      gridScrollRef.current = window.scrollY || 0;
    }
    if (target.view === "garage") {
      setSelectedTote(null);
      setEditingTote(null);
      setSelectedPosition("");
      setHighlightItemId(undefined);
      if (target.grid) {
        setSearchTerm(target.grid.q);
        setMode(target.grid.mode);
        setActiveWallId(target.grid.wall);
      }
    } else if (target.view === "detail") {
      setSelectedTote(target.tote);
      setEditingTote(null);
      setHighlightItemId(target.itemId);
    } else {
      setEditingTote(target.editTote);
      setSelectedPosition(target.position);
    }
    setView(target.view);
  }, []);

  /** Open a screen as a new history entry (the back gesture returns here). */
  const go = (target) => {
    pendingRef.current = null;
    // The entry we leave must carry the garage state it ended with
    if (live.current.view === "garage") replaceUrl(gridUrl());
    const depth = (historyDepth(window.history.state) ?? 0) + 1;
    try {
      window.history.pushState(navState(depth), "", urlFor(target));
    } catch {
      /* fall through: the screen still changes */
    }
    show(target);
  };

  /** Back button / after save or delete: step back a screen. */
  const goBack = () => {
    if ((historyDepth(window.history.state) ?? 0) > 0) {
      // popstate does the rest, exactly as for the iOS back gesture
      window.history.back();
      return;
    }
    // Nothing of ours behind this entry (deep link, home screen launch)
    pendingRef.current = null;
    const target = { view: "garage" };
    replaceUrl(urlFor(target));
    show(target);
  };

  // Browser Back/Forward and the iOS edge swipe
  useEffect(() => {
    const onPop = () => {
      pendingRef.current = null;
      const route = parseRoute(window.location.search);
      const s = live.current;
      if (route.view === "grid") {
        show({
          view: "garage",
          grid: gridFromRoute(
            route,
            s.walls.map((w) => w.id)
          ),
        });
        return;
      }
      const resolved = resolveRoute(route, s);
      if (resolved.missing) {
        toast.show(resolved.missing);
        const target = { view: "garage" };
        replaceUrl(urlFor(target));
        show(target);
        return;
      }
      // ?slot= and ?new= may now mean a different screen: make the URL honest
      const url = urlFor(resolved);
      if (url !== currentPath()) replaceUrl(url);
      show(resolved);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // urlFor / replaceUrl / gridUrl only read refs and window
  }, [show, toast]);

  // Deep links: resolve once the data is in, replacing the URL so the link
  // does not leave a dead entry behind it. `source` is null when nothing
  // loaded at all; then "missing" would be a lie, so keep waiting.
  useLayoutEffect(() => {
    const route = pendingRef.current;
    if (!route || loading || source === null) return;
    pendingRef.current = null;
    const resolved = resolveRoute(route, { totes, totesByPosition, walls });
    if (resolved.missing) {
      toast.show(resolved.missing);
      const target = { view: "garage" };
      replaceUrl(urlFor(target));
      show(target);
      return;
    }
    replaceUrl(urlFor(resolved));
    show(resolved);
  }, [loading, source, totes, totesByPosition, walls, show, toast]);

  // Keep the garage URL (wall / search / mode) current. Debounced: Safari
  // refuses history calls past ~100 per 30 seconds and typing is fast.
  useEffect(() => {
    if (view !== "garage") return undefined;
    const timer = setTimeout(() => {
      if (live.current.view !== "garage" || pendingRef.current) return;
      const url = gridUrl();
      if (url !== currentPath()) replaceUrl(url);
    }, 300);
    return () => clearTimeout(timer);
  }, [view, searchTerm, mode, activeWallId]);

  const handleSelectTote = (tote, { itemId } = {}) => {
    go({ view: "detail", tote, itemId });
  };

  const handleAddTote = (position) => {
    go({ view: "form", editTote: null, position });
  };

  const handleEditTote = (tote) => {
    go({ view: "form", editTote: tote, position: tote.position });
  };

  /** Change wall; optionally highlight a slot ("Show me"). */
  const handleWallChange = (wallId, highlight = null) => {
    setActiveWallId(wallId);
    setHighlightPosition(highlight);
  };

  /** From a tote's detail page: jump to its slot in the garage view. */
  const handleShowInGarage = (position) => {
    const wall = getWallForPosition(position);
    const wallId = wall ? wall.id : "front";
    setActiveWallId(wallId);
    setHighlightPosition(position);
    // Land on the garage, not on a search that was still open
    gridScrollRef.current = 0;
    go({ view: "garage", grid: { wall: wallId, q: "", mode: "garage" } });
  };

  /** Another tote (duplicate hint, search elsewhere): open it, mark the item. */
  const handleOpenTote = (tote, { itemId } = {}) => {
    go({ view: "detail", tote, itemId });
  };

  const clearHighlight = useCallback(() => setHighlightPosition(null), []);

  // A tote or form page starts at the top: the browser would otherwise keep
  // the grid's scroll offset (a scrolled results list opened the tote). The
  // grid restores its own place on the way back; a highlighted item scrolls
  // the tote page to itself afterwards.
  const screenKey = `${view}:${selectedTote?.id ?? ""}:${editingTote?.id ?? ""}`;
  useLayoutEffect(() => {
    if (view !== "garage") window.scrollTo(0, 0);
  }, [view, screenKey]);

  return (
    <>
      {view === "garage" && (
        <GridPage
          onSelectTote={handleSelectTote}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          mode={mode}
          onModeChange={setMode}
          initialScrollY={gridScrollRef.current}
          onAddTote={handleAddTote}
          activeWallId={activeWallId}
          onWallChange={handleWallChange}
          highlightPosition={highlightPosition}
          onClearHighlight={clearHighlight}
        />
      )}
      {view === "detail" && selectedTote && (
        <DetailPage
          // Each tote starts fresh (staged taps, sheets) when one opens another
          key={String(selectedTote.id)}
          tote={selectedTote}
          highlightItemId={highlightItemId}
          onBack={goBack}
          onEdit={handleEditTote}
          onDeleted={goBack}
          onShowInGarage={handleShowInGarage}
          onOpenTote={handleOpenTote}
        />
      )}
      {view === "form" && (
        <FormPage
          editTote={editingTote}
          position={selectedPosition}
          onBack={goBack}
          onSaved={goBack}
        />
      )}
    </>
  );
}

export default function ToteInventoryApp() {
  return (
    <ErrorBoundary>
      <ToteProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </ToteProvider>
    </ErrorBoundary>
  );
}
