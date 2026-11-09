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
  NO_CAPABILITIES,
  storageMode,
  toteService,
  UserFacingError,
} from "../services/toteService";
import { buildWalls, DEFAULT_LAYOUT, wallPositions } from "../utils/constants";
import { prefetchPhotos } from "../utils/photoPrefetch";
import { reconcileQtyOp } from "../utils/qtyOps";
import { isReservedPosition } from "../utils/reservedRows";

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

/**
 * `totes` with the row a write handed back in place of its old copy. A row
 * at a reserved "__" position (tombstone, settings, bin) is not a tote: it is
 * dropped instead, so no write path can ever put one on a wall, in search or
 * in a count. The service refuses such writes itself; this is the backstop.
 */
function withSavedRow(prev, row) {
  if (!row) return prev;
  if (isReservedPosition(row.position)) {
    return prev.filter((t) => t.id !== row.id);
  }
  return prev.map((t) => (t.id === row.id ? row : t));
}

export function ToteProvider({ children }) {
  const [totes, setTotes] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState(null); // "cloud" | "cache" | "local"
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  // Recently deleted totes [{ id, name, originalPosition, deletedAt, items }]
  const [deleted, setDeleted] = useState([]);
  // Optional database features { tags, notes, swap } (see MAINTENANCE.md)
  const [capabilities, setCapabilities] = useState(NO_CAPABILITIES);
  const deletedRef = useRef(deleted);
  deletedRef.current = deleted;
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
      const {
        data,
        source: src,
        layout: savedLayout,
        deleted: trash,
        capabilities: caps,
      } = await toteService.getTotes();
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
      // `deleted` and `capabilities` belong to the same load as `totes`, so
      // they sit inside the same guard: a stale or cache-sourced response can
      // never switch capabilities back off or overwrite `deleted` with a list
      // from before the last deleteTote. Any handler that patches state from
      // realtime payloads instead of reloading must use
      // utils/realtime.applyRealtimeChange (reserved "__" positions =
      // removal, never an insert).
      setTotes(Array.isArray(data) ? data : []);
      setSource(src);
      if (savedLayout) setLayout({ ...DEFAULT_LAYOUT, ...savedLayout });
      setDeleted(Array.isArray(trash) ? trash : []);
      if (caps) setCapabilities(caps);
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
      return withSavedRow(prev, savedTote);
    });
    return savedTote;
  }, []);

  /** Soft-delete: the tote moves to Recently deleted (30 days). */
  const deleteTote = useCallback(async (id) => {
    const entry = await toteService.deleteTote(id);
    setTotes((prev) => prev.filter((t) => t.id !== id));
    if (entry) {
      setDeleted((prev) => [entry, ...prev.filter((d) => d.id !== entry.id)]);
    }
  }, []);

  /** Patch specific fields (items, position, name) of one tote. */
  const updateTote = useCallback(async (id, fields) => {
    const savedTote = await toteService.updateTote(id, fields);
    setTotes((prev) => withSavedRow(prev, savedTote));
    return savedTote;
  }, []);

  /** Edit one tote's tags by delta (utils/tagOps), merged by the service
   *  into the tags as STORED (compare-and-swap). Resolves to
   *  { tote, applied } — `applied` is what the write really changed. */
  const updateTags = useCallback(async (id, delta) => {
    const result = await toteService.updateTags(id, delta);
    setTotes((prev) => withSavedRow(prev, result?.tote));
    return result;
  }, []);

  /** Save one tote's note unless it changed since the editor opened
   *  (`expected`): then rejects with code NOTES_CHANGED, details.theirs. */
  const updateNotes = useCallback(async (id, notes, options) => {
    const savedTote = await toteService.updateNotes(id, notes, options);
    setTotes((prev) => withSavedRow(prev, savedTote));
    return savedTote;
  }, []);

  /** Change one tote's items by applying a pure operation (utils/itemOps)
   *  to the freshest stored copy — safe against the other phone editing the
   *  same tote at the same time. */
  const updateItems = useCallback(async (id, mutate) => {
    const savedTote = await toteService.updateItems(id, mutate);
    setTotes((prev) => withSavedRow(prev, savedTote));
    return savedTote;
  }, []);

  /** Move a tote to a new (empty) position — patches position only, so a
   *  concurrent item edit can never be clobbered or reverted. */
  const moveTote = useCallback(
    (tote, position) => updateTote(tote.id, { position }),
    [updateTote]
  );

  /** Put a soft-deleted tote back (keeps its id and created_at). Updates
   *  the lists; realtime/local reloads agree with this. */
  const restoreDeletedTote = useCallback(async (id, targetPosition) => {
    const row = await toteService.restoreDeletedTote(id, targetPosition);
    setDeleted((prev) => prev.filter((d) => d.id !== row.id));
    setTotes((prev) => [...prev.filter((t) => t.id !== row.id), row]);
    return row;
  }, []);

  /** Permanently remove a tote from Recently deleted. */
  const purgeDeletedTote = useCallback(async (id) => {
    await toteService.purgeDeletedTote(id);
    setDeleted((prev) => prev.filter((d) => d.id !== id));
  }, []);

  /**
   * Undo a delete. The soft-deleted row itself comes back (same id and
   * created_at) — found by the snapshot's `id`, or, for an id-less snapshot,
   * by the newest tombstone with the same name and spot (the one the user
   * just deleted). Only when no tombstone exists any more is the tote
   * re-created from the snapshot.
   *
   * The snapshot's quantities win over the stored ones for items both have:
   * the detail page puts still-staged +/- taps into the Undo snapshot, and
   * those never reached the database before the delete. They are re-applied
   * as an idempotent op through updateItems (never a snapshot write), so an
   * item the other phone added or removed meanwhile is left alone.
   */
  const restoreTote = useCallback(
    async (tote) => {
      let id = tote?.id;
      if (id === undefined || id === null) {
        const match = deletedRef.current.find(
          (d) => d.originalPosition === tote?.position && d.name === tote?.name
        ); // `deleted` is newest first
        if (match) id = match.id;
      }
      if (id !== undefined && id !== null) {
        let row = null;
        try {
          row = await restoreDeletedTote(id);
        } catch (err) {
          if (err?.code !== "NO_TOMBSTONE") throw err;
        }
        if (row) {
          const op = reconcileQtyOp(tote?.items, row.items);
          if (!op) return row;
          try {
            return await updateItems(row.id, op);
          } catch {
            // The tote IS back — only the staged taps didn't land
            throw new UserFacingError(
              `Put “${row.name}” back, but its latest quantity changes didn't save. Please check it.`
            );
          }
        }
      }
      return saveTote(
        { name: tote.name, position: tote.position, items: tote.items },
        true
      );
    },
    [restoreDeletedTote, saveTote, updateItems]
  );

  /** Swap two totes' spots in one step (cloud: one database transaction).
   *  `options.expectA/expectB`: the spots the user saw — the swap is refused
   *  (code TOTE_MOVED) when either tote is no longer there. */
  const swapTotes = useCallback(async (aId, bId, options) => {
    const rows = await toteService.swapTotes(aId, bId, options);
    setTotes((prev) =>
      prev.map((t) => rows.find((r) => r.id === t.id) || t)
    );
    return rows;
  }, []);

  /** Remember items removed from a tote so they can be put back (30 days). */
  const recordRemovedItems = useCallback(
    (tote, items) => toteService.recordRemovedItems(tote, items),
    []
  );

  /** Entries in the removed-items bin, newest first. */
  const listRemovedItems = useCallback(() => toteService.listRemovedItems(), []);

  /** Drop the bin entries for items an Undo put back into `toteId`. */
  const forgetRemovedItems = useCallback(
    (toteId, itemIds) => toteService.forgetRemovedItems(toteId, itemIds),
    []
  );

  /** Put a removed item back into its tote (or `targetToteId`). */
  const restoreRemovedItem = useCallback(async (entryId, targetToteId) => {
    const savedTote = await toteService.restoreRemovedItem(entryId, targetToteId);
    setTotes((prev) => withSavedRow(prev, savedTote));
    return savedTote;
  }, []);

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

  // Warm the offline photo cache after a successful CLOUD load: ask the
  // service worker for the photos of the totes on the walls, so they are
  // there when the phone loses signal in the garage. Only URLs not yet
  // handed over are sent (a realtime reload with the same photos sends
  // nothing); a URL the worker could not be asked about (no controller yet)
  // stays unsent so a later load retries it. Never runs in local mode.
  const prefetchedRef = useRef(new Set());
  useEffect(() => {
    if (storageMode !== "cloud" || source !== "cloud") return;
    const fresh = new Set();
    Object.values(totesByPosition).forEach((tote) => {
      if (isReservedPosition(tote.position)) return;
      (Array.isArray(tote.items) ? tote.items : []).forEach((item) => {
        const url = item?.image;
        if (
          typeof url === "string" &&
          /^https?:\/\//i.test(url) &&
          !prefetchedRef.current.has(url)
        ) {
          fresh.add(url);
        }
      });
    });
    if (fresh.size === 0) return;
    if (prefetchPhotos([...fresh]) > 0) {
      fresh.forEach((url) => prefetchedRef.current.add(url));
    }
    // lastSyncedAt: every successful cloud load re-checks, so URLs the worker
    // could not take earlier are retried even when the photos did not change
  }, [source, totesByPosition, lastSyncedAt]);

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
      updateTags,
      updateNotes,
      updateItems,
      deleteTote,
      moveTote,
      restoreTote,
      saveLayout,
      // Freshness: when the cloud copy was last fetched, and the realtime link
      lastSyncedAt,
      connection,
      // --- recently deleted, swap, tags/notes capabilities, removed-items bin ---
      deleted,
      capabilities,
      swapTotes,
      restoreDeletedTote,
      purgeDeletedTote,
      recordRemovedItems,
      listRemovedItems,
      forgetRemovedItems,
      restoreRemovedItem,
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
      updateTags,
      updateNotes,
      updateItems,
      deleteTote,
      moveTote,
      restoreTote,
      saveLayout,
      lastSyncedAt,
      connection,
      deleted,
      capabilities,
      swapTotes,
      restoreDeletedTote,
      purgeDeletedTote,
      recordRemovedItems,
      listRemovedItems,
      forgetRemovedItems,
      restoreRemovedItem,
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
