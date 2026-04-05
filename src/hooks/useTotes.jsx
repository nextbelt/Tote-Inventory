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
  const [loading, setLoading] = useState(true);
  const subscriptionRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await toteService.getTotes();
      setTotes(Array.isArray(data) ? data : []);
    } catch {
      setTotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialise: test connection, load data, subscribe to real-time changes
  useEffect(() => {
    const init = async () => {
      await toteService.testConnection();
      await migrateLocalToSupabase();
      await loadData();
    };
    init();

    subscriptionRef.current = toteService.subscribeToChanges(() => {
      loadData();
    });

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, [loadData]);

  const saveTote = useCallback(async (tote, isNew) => {
    const savedTote = await toteService.saveTote(tote, isNew);
    if (isNew) {
      setTotes((prev) => [...prev, savedTote]);
    } else {
      setTotes((prev) =>
        prev.map((t) => (t.id === savedTote.id ? savedTote : t))
      );
    }
    return savedTote;
  }, []);

  const deleteTote = useCallback(async (id) => {
    await toteService.deleteTote(id);
    setTotes((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(
    () => ({ totes, loading, loadData, saveTote, deleteTote }),
    [totes, loading, loadData, saveTote, deleteTote]
  );

  return <ToteContext.Provider value={value}>{children}</ToteContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTotes() {
  const ctx = useContext(ToteContext);
  if (!ctx) throw new Error("useTotes must be used within a ToteProvider");
  return ctx;
}
