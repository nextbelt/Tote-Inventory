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
// A refetch that fell back to the cache (radio still waking, request hung)
// is retried on its own backoff, so the phone recovers without user action.
export const FETCH_RETRY_BASE_MS = 2000;
export const FETCH_RETRY_MAX_MS = 30000;
// When the cloud copy was last fetched, persisted so a cold start without
// signal can still say how old the cached copy is.
export const SYNCED_AT_KEY = "totes-cache-synced-at";

const DROPPED_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

function readSyncedAt() {
  if (storageMode !== "cloud") return null;
  try {
    const value = Number(localStorage.getItem(SYNCED_AT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSyncedAt(ms) {
  try {
    localStorage.setItem(SYNCED_AT_KEY, String(ms));
  } catch {
    // localStorage may be full or unavailable; the in-memory value still works
  }
}

export function ToteProvider({ children }) {
  const [totes, setTotes] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState(null); // "cloud" | "cache" | "local"
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  // Epoch ms of the last successful CLOUD fetch (never set by cache/local).
  // Seeded from the previous session so an offline cold start knows its age.
  const [lastSyncedAt, setLastSyncedAt] = useState(readSyncedAt);
  // "live" (channel subscribed) | "connecting" (subscribing / retrying) |
  // "offline" (browser reports no network, or there is no cloud at all)
  const [connection, setConnection] = useState(
    storageMode === "cloud" ? "connecting" : "offline"
  );
  const lastSyncedAtRef = useRef(lastSyncedAt);
  const sourceRef = useRef(null); // where the data on screen came from
  const requestSeqRef = useRef(0); // id of the newest request started
  const lastAppliedSeqRef = useRef(0); // id of the newest response applied
  const foregroundSeqRef = useRef(0); // request that turned the spinner on
  const channelLiveRef = useRef(false); // realtime channel confirmed SUBSCRIBED
  const fetchOutcomeRef = useRef(null); // set by the effect: (ok) => void

  const loadData = useCallback(async ({ background = false } = {}) => {
    // Sequence guard: several loads can overlap (realtime event + wake-up
    // refetch + pull-to-refresh). A response is applied only if it is newer
    // than the last one applied, so a slow, older response can never
    // overwrite newer data, while a steady stream of events (each starting
    // a new request) cannot starve every response either.
    const seq = ++requestSeqRef.current;
    const isNewest = () => seq === requestSeqRef.current;
    const canApply = () => seq > lastAppliedSeqRef.current;
    if (!background) {
      foregroundSeqRef.current = seq;
      setRefreshing(true);
    }
    // The spinner belongs to the newest foreground request: clear it when
    // that request (or a later one) settles, or when any data is applied.
    const settleSpinner = () => {
      if (seq >= foregroundSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    };
    try {
      const { data, source: src, layout: savedLayout } =
        await toteService.getTotes();
      if (!canApply()) return;

      if (src === "cache" && sourceRef.current === "cloud") {
        // The cloud was unreachable for this refetch, but what is on screen
        // came from the cloud, possibly with edits the cache never saw
        // (updateItems/saveTote do not write it, and it strips photos). Keep
        // the fresh in-memory copy; just flag the link and retry shortly.
        if (isNewest()) {
          setConnection(navigator.onLine === false ? "offline" : "connecting");
          fetchOutcomeRef.current?.(false);
        }
        settleSpinner();
        return;
      }

      // A cached copy is only a stop-gap: it must not block a slower cloud
      // response that started earlier (cloud always beats its own mirror).
      if (src !== "cache") lastAppliedSeqRef.current = seq;
      sourceRef.current = src;
      setTotes(Array.isArray(data) ? data : []);
      setSource(src);
      if (savedLayout) setLayout({ ...DEFAULT_LAYOUT, ...savedLayout });
      if (src === "cloud") {
        const now = Date.now();
        lastSyncedAtRef.current = now;
        setLastSyncedAt(now);
        writeSyncedAt(now);
        // A fetch succeeded, so the network is back even if an "offline"
        // event said otherwise; the channel decides whether we are "live".
        setConnection(channelLiveRef.current ? "live" : "connecting");
        fetchOutcomeRef.current?.(true);
      } else if (src === "cache" && isNewest()) {
        // Nothing from the cloud yet this session: show the cached copy but
        // keep trying for a fresh one.
        fetchOutcomeRef.current?.(false);
      }
      // Data applied: whatever spinner was on, the user now has fresh data
      setLoading(false);
      setRefreshing(false);
    } catch {
      if (!canApply()) return;
      // Only wipe the view if there was never anything to show
      if (sourceRef.current === null) setTotes([]);
      if (isNewest()) fetchOutcomeRef.current?.(false);
      settleSpinner();
    }
  }, []);

  // Initialise: migrate any legacy local data, load, subscribe to realtime.
  // Keep the subscription alive: resubscribe with backoff after the channel
  // drops, and catch up when the phone wakes or the network returns.
  useEffect(() => {
    let disposed = false;
    let channel = null;
    let channelGen = 0; // bumps on every (re)subscribe; stale callbacks ignored
    let needsCatchUp = false; // channel was down (or unconfirmed) since live
    let hiddenAt = null; // when the page last went to the background
    let reconnectTimer = null;
    let reconnectDelay = RECONNECT_BASE_MS;
    let fetchRetryTimer = null;
    let fetchRetryDelay = FETCH_RETRY_BASE_MS;
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

    const clearFetchRetry = () => {
      if (fetchRetryTimer) {
        clearTimeout(fetchRetryTimer);
        fetchRetryTimer = null;
      }
    };

    // Called by loadData for the newest response: true = cloud fetch worked
    fetchOutcomeRef.current = (ok) => {
      if (disposed) return;
      if (ok) {
        clearFetchRetry();
        fetchRetryDelay = FETCH_RETRY_BASE_MS;
        return;
      }
      if (!hasCloud || fetchRetryTimer) return;
      const delay = fetchRetryDelay;
      fetchRetryDelay = Math.min(fetchRetryDelay * 2, FETCH_RETRY_MAX_MS);
      fetchRetryTimer = setTimeout(() => {
        fetchRetryTimer = null;
        loadData({ background: true });
      }, delay);
    };

    const markChannelDown = () => {
      channelLiveRef.current = false;
      needsCatchUp = true;
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
      // Replacing a channel means events may have been missed in between
      if (gen > 1) markChannelDown();
      channelLiveRef.current = false;
      setConnection(navigator.onLine === false ? "offline" : "connecting");

      channel = toteService.subscribeToChanges(
        () => {
          loadData({ background: true });
        },
        (status) => {
          if (disposed || gen !== channelGen) return;
          if (status === "SUBSCRIBED") {
            channelLiveRef.current = true;
            reconnectDelay = RECONNECT_BASE_MS;
            clearReconnectTimer();
            setConnection("live");
            // Changes may have been missed while the channel was down. This
            // covers both a replaced channel and realtime-js rejoining the
            // same channel by itself after an error.
            if (needsCatchUp) {
              needsCatchUp = false;
              loadData({ background: true });
            }
          } else if (DROPPED_STATUSES.has(status)) {
            markChannelDown();
            setConnection(navigator.onLine === false ? "offline" : "connecting");
            scheduleReconnect();
          }
        }
      );
      if (!channel) scheduleReconnect(); // client refused to create a channel
    };

    // Skip the backoff: the user is looking at the screen / network is back
    const reconnectNow = () => {
      if (!hasCloud || channelLiveRef.current) return;
      clearReconnectTimer();
      reconnectDelay = RECONNECT_BASE_MS;
      connect();
    };

    const isStale = () => {
      const last = lastSyncedAtRef.current;
      return !last || Date.now() - last > STALE_AFTER_MS;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // After a long sleep iOS may have killed the socket without ever
      // delivering a status, so a "live" channel cannot be trusted: rebuild
      // it and let its SUBSCRIBED confirm we are live again.
      if (hasCloud && hiddenFor > STALE_AFTER_MS) markChannelDown();
      const channelDown = hasCloud && !channelLiveRef.current;
      if (channelDown) reconnectNow();
      if (channelDown || isStale()) loadData({ background: true });
    };

    const onOnline = () => {
      if (hasCloud) {
        if (channelLiveRef.current) setConnection("live");
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
      fetchOutcomeRef.current = null;
      clearReconnectTimer();
      clearFetchRetry();
      teardownChannel();
      channelLiveRef.current = false;
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
