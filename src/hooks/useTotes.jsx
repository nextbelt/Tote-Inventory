import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  migrateLocalToSupabase,
  storageMode,
  toteService,
} from "../services/toteService";
import { buildWalls, DEFAULT_LAYOUT, wallPositions } from "../utils/constants";

const ToteContext = createContext(null);

// Freshness / reconnect tuning. iOS suspends the websocket while the app is
// in the background, so when the phone wakes we refetch if the data is older
// than this or the realtime channel is not confirmed live.
export const STALE_AFTER_MS = 30000;
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30000;

const DROPPED_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export function ToteProvider({ children }) {
  const [totes, setTotes] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState(null); // "cloud" | "cache" | "local"
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  // Epoch ms of the last successful CLOUD fetch (never set by cache/local)
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // "live" (channel subscribed) | "connecting" (subscribing / retrying) |
  // "offline" (browser reports no network, or there is no cloud at all)
  const [connection, setConnection] = useState(
    storageMode === "cloud" ? "connecting" : "offline"
  );
  const lastSyncedAtRef = useRef(null);
  const requestSeqRef = useRef(0);

  const loadData = useCallback(async ({ background = false } = {}) => {
    // Sequence guard: several loads can overlap (realtime event + wake-up
    // refetch + pull-to-refresh). Only the newest request may apply its
    // result, so a slow, older response can never overwrite newer data.
    const seq = ++requestSeqRef.current;
    const isCurrent = () => seq === requestSeqRef.current;
    if (!background) setRefreshing(true);
    try {
      const { data, source: src, layout: savedLayout } =
        await toteService.getTotes();
      if (!isCurrent()) return;
      setTotes(Array.isArray(data) ? data : []);
      setSource(src);
      if (savedLayout) setLayout({ ...DEFAULT_LAYOUT, ...savedLayout });
      if (src === "cloud") {
        const now = Date.now();
        lastSyncedAtRef.current = now;
        setLastSyncedAt(now);
      }
    } catch {
      if (!isCurrent()) return;
      setTotes([]);
    } finally {
      // A superseded request leaves the spinner to the request that replaced it
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initialise: migrate any legacy local data, load, subscribe to realtime.
  // Keep the subscription alive: resubscribe with backoff after the channel
  // drops, and catch up when the phone wakes or the network returns.
  useEffect(() => {
    let disposed = false;
    let channel = null;
    let channelGen = 0; // bumps on every (re)subscribe; stale callbacks ignored
    let subscribed = false;
    let reconnectTimer = null;
    let reconnectDelay = RECONNECT_BASE_MS;
    const hasCloud = storageMode === "cloud";

    const init = async () => {
      await migrateLocalToSupabase();
      await loadData();
    };
    init();

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const teardownChannel = () => {
      const old = channel;
      channel = null;
      channelGen += 1; // its CLOSED status (from our own leave) is now stale
      if (old) toteService.unsubscribeFromChanges(old);
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || !hasCloud) return;
      teardownChannel();
      const gen = channelGen;
      subscribed = false;
      setConnection(navigator.onLine === false ? "offline" : "connecting");

      channel = toteService.subscribeToChanges(
        () => {
          loadData({ background: true });
        },
        (status) => {
          if (disposed || gen !== channelGen) return;
          if (status === "SUBSCRIBED") {
            subscribed = true;
            reconnectDelay = RECONNECT_BASE_MS;
            clearReconnectTimer();
            setConnection("live");
            // A re-subscribe means changes may have been missed while down
            if (gen > 1) loadData({ background: true });
          } else if (DROPPED_STATUSES.has(status)) {
            subscribed = false;
            setConnection(navigator.onLine === false ? "offline" : "connecting");
            scheduleReconnect();
          }
        }
      );
      if (!channel) scheduleReconnect(); // client refused to create a channel
    };

    // Skip the backoff: the user is looking at the screen / network is back
    const reconnectNow = () => {
      if (!hasCloud || subscribed) return;
      clearReconnectTimer();
      reconnectDelay = RECONNECT_BASE_MS;
      connect();
    };

    const isStale = () => {
      const last = lastSyncedAtRef.current;
      return !last || Date.now() - last > STALE_AFTER_MS;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const channelDown = hasCloud && !subscribed;
      if (channelDown) reconnectNow();
      if (channelDown || isStale()) loadData({ background: true });
    };

    const onOnline = () => {
      if (hasCloud) {
        if (subscribed) setConnection("live");
        else reconnectNow();
      }
      loadData({ background: true });
    };

    const onOffline = () => {
      setConnection("offline");
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      clearReconnectTimer();
      teardownChannel();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
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
      // Freshness: when the cloud copy was last fetched, and the realtime link
      lastSyncedAt,
      connection,
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
      lastSyncedAt,
      connection,
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
