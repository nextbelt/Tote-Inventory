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

const ToteContext = createContext(null);

export function ToteProvider({ children }) {
  const [totes, setTotes] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState(null); // "cloud" | "cache" | "local"
  const subscriptionRef = useRef(null);

  const loadData = useCallback(async ({ background = false } = {}) => {
    if (!background) setRefreshing(true);
    try {
      const { data, source: src } = await toteService.getTotes();
      setTotes(Array.isArray(data) ? data : []);
      setSource(src);
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

  /** Move a tote to a new (empty) position. */
  const moveTote = useCallback(
    (tote, position) => saveTote({ ...tote, position }, false),
    [saveTote]
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

  const value = useMemo(
    () => ({
      totes,
      totesByPosition,
      loading,
      refreshing,
      source,
      loadData,
      saveTote,
      deleteTote,
      moveTote,
      restoreTote,
    }),
    [
      totes,
      totesByPosition,
      loading,
      refreshing,
      source,
      loadData,
      saveTote,
      deleteTote,
      moveTote,
      restoreTote,
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
