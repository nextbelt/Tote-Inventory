import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { migrateLocalToSupabase, toteService } from "../services/toteService";
import { buildWalls, DEFAULT_LAYOUT, wallPositions } from "../utils/constants";

const ToteContext = createContext(null);

export function ToteProvider({ children }) {
  const [totes, setTotes] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState(null); // "cloud" | "cache" | "local"
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const subscriptionRef = useRef(null);

  const loadData = useCallback(async ({ background = false } = {}) => {
    if (!background) setRefreshing(true);
    try {
      const { data, source: src, layout: savedLayout } =
        await toteService.getTotes();
      setTotes(Array.isArray(data) ? data : []);
      setSource(src);
      if (savedLayout) setLayout({ ...DEFAULT_LAYOUT, ...savedLayout });
    } catch {
      setTotes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initialise: migrate any legacy local data, load, subscribe to realtime
  useEffect(() => {
    const init = async () => {
      await migrateLocalToSupabase();
      await loadData();
    };
    init();

    subscriptionRef.current = toteService.subscribeToChanges(() => {
      loadData({ background: true });
    });

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, [loadData]);

  const saveTote = useCallback(async (tote, isNew) => {
    const savedTote = await toteService.saveTote(tote, isNew);
    setTotes((prev) => {
      if (isNew) return [...prev, savedTote];
      return prev.map((t) => (t.id === savedTote.id ? savedTote : t));
    });
    return savedTote;
  }, []);

  const deleteTote = useCallback(async (id) => {
    await toteService.deleteTote(id);
    setTotes((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Patch specific fields (items, position, name) of one tote. */
  const updateTote = useCallback(async (id, fields) => {
    const savedTote = await toteService.updateTote(id, fields);
    setTotes((prev) => prev.map((t) => (t.id === savedTote.id ? savedTote : t)));
    return savedTote;
  }, []);

  /** Change one tote's items by applying a pure operation (utils/itemOps)
   *  to the freshest stored copy — safe against the other phone editing the
   *  same tote at the same time. */
  const updateItems = useCallback(async (id, mutate) => {
    const savedTote = await toteService.updateItems(id, mutate);
    setTotes((prev) => prev.map((t) => (t.id === savedTote.id ? savedTote : t)));
    return savedTote;
  }, []);

  /** Move a tote to a new (empty) position — patches position only, so a
   *  concurrent item edit can never be clobbered or reverted. */
  const moveTote = useCallback(
    (tote, position) => updateTote(tote.id, { position }),
    [updateTote]
  );

  /** Re-create a just-deleted tote (undo). Gets a fresh id. */
  const restoreTote = useCallback(
    (tote) =>
      saveTote(
        { name: tote.name, position: tote.position, items: tote.items },
        true
      ),
    [saveTote]
  );

  /** Save the side-wall shelf counts (synced to other devices). */
  const saveLayout = useCallback(async (nextLayout) => {
    const merged = { ...DEFAULT_LAYOUT, ...nextLayout };
    await toteService.saveLayout(merged);
    setLayout(merged);
    return merged;
  }, []);

  // One tote per position (positions are unique in the database; local mode
  // keeps the most recently updated if legacy duplicates exist).
  const totesByPosition = useMemo(() => {
    const map = {};
    totes.forEach((tote) => {
      const existing = map[tote.position];
      if (
        !existing ||
        new Date(tote.updated_at || 0) > new Date(existing.updated_at || 0)
      ) {
        map[tote.position] = tote;
      }
    });
    return map;
  }, [totes]);

  // Walls derive from the saved layout; occupied slots always stay visible
  const walls = useMemo(
    () => buildWalls(layout, Object.keys(totesByPosition)),
    [layout, totesByPosition]
  );
  const totalPositions = useMemo(() => wallPositions(walls).length, [walls]);

  const value = useMemo(
    () => ({
      totes,
      totesByPosition,
      loading,
      refreshing,
      source,
      layout,
      walls,
      totalPositions,
      loadData,
      saveTote,
      updateTote,
      updateItems,
      deleteTote,
      moveTote,
      restoreTote,
      saveLayout,
    }),
    [
      totes,
      totesByPosition,
      loading,
      refreshing,
      source,
      layout,
      walls,
      totalPositions,
      loadData,
      saveTote,
      updateTote,
      updateItems,
      deleteTote,
      moveTote,
      restoreTote,
      saveLayout,
    ]
  );

  return <ToteContext.Provider value={value}>{children}</ToteContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTotes() {
  const ctx = useContext(ToteContext);
  if (!ctx) throw new Error("useTotes must be used within a ToteProvider");
  return ctx;
}
