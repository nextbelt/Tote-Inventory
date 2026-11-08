import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SyncStatus from "../../components/SyncStatus";
import { formatTimeOfDay } from "../../utils/time";

// ---------------------------------------------------------------------------
// Freshness + reconnect behaviour of ToteProvider in cloud mode. The service
// is faked so tests control when each fetch resolves and can play realtime
// channel statuses (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED).
// ---------------------------------------------------------------------------

const svc = vi.hoisted(() => ({
  getTotes: null,
  channels: [],
  removed: [],
}));

vi.mock("../../services/toteService", () => ({
  storageMode: "cloud",
  migrateLocalToSupabase: async () => {},
  toteService: {
    getTotes: (...args) => svc.getTotes(...args),
    subscribeToChanges: (onChange, onStatus) => {
      const channel = { id: svc.channels.length + 1, onChange, onStatus };
      svc.channels.push(channel);
      return channel;
    },
    unsubscribeFromChanges: (channel) => {
      svc.removed.push(channel);
    },
  },
}));

import { SYNCED_AT_KEY, ToteProvider, useTotes } from "../useTotes";

function Probe() {
  const { totes, lastSyncedAt, connection, source, loading, refreshing } =
    useTotes();
  return (
    <>
      <div
        data-testid="probe"
        data-connection={connection}
        data-synced={lastSyncedAt ?? ""}
        data-source={source ?? ""}
        data-loading={String(loading)}
        data-refreshing={String(refreshing)}
      >
        {totes.map((t) => t.name).join(",")}
      </div>
      <SyncStatus source={source} lastSyncedAt={lastSyncedAt} connection={connection} />
    </>
  );
}

const probe = () => screen.getByTestId("probe");
const statusText = () => screen.getByTestId("sync-status").textContent;
const cloud = (names) => ({
  data: names.map((name, i) => ({ id: i + 1, name, position: `A${i + 1}`, items: [] })),
  source: "cloud",
  layout: null,
});
const cache = (names) => ({ ...cloud(names), source: "cache" });

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let pending promise chains (init → migrate → load) settle. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

// Each helper settles inside act() because a status/visibility/network
// event may kick off a background fetch that resolves a microtask later.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const status = (channel, s) =>
  act(async () => {
    channel.onStatus(s);
    await settle();
  });
const change = (channel) =>
  act(async () => {
    channel.onChange({});
    await settle();
  });
const fireVisible = () =>
  act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
  });
const fireWindow = (name) =>
  act(async () => {
    window.dispatchEvent(new Event(name));
    await settle();
  });

/** Pretend the page went to the background / came back (iOS app switch). */
async function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  await fireVisible();
}

let fetchCount;

async function mount() {
  render(
    <ToteProvider>
      <Probe />
    </ToteProvider>
  );
  await flush();
}

describe("ToteProvider sync freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
    svc.channels = [];
    svc.removed = [];
    fetchCount = 0;
    svc.getTotes = async () => {
      fetchCount += 1;
      return cloud(["Camping"]);
    };
  });
  afterEach(() => {
    delete document.visibilityState;
    vi.useRealTimers();
  });

  describe("overlapping fetches", () => {
    it("a slow older response never overwrites newer data", async () => {
      const first = deferred();
      const second = deferred();
      const queue = [first, second];
      svc.getTotes = () => queue.shift().promise;

      await mount();
      expect(probe()).toHaveAttribute("data-loading", "true");

      // A realtime event arrives while the initial load is still in flight
      await change(svc.channels[0]);

      second.resolve(cloud(["Fresh"]));
      await flush();
      expect(probe()).toHaveTextContent("Fresh");
      expect(probe()).toHaveAttribute("data-loading", "false");
      expect(probe()).toHaveAttribute("data-refreshing", "false");

      // The older request finally finishes — it must be ignored
      first.resolve(cloud(["Stale"]));
      await flush();
      expect(probe()).toHaveTextContent("Fresh");
      expect(probe()).not.toHaveTextContent("Stale");
    });

    it("applies every response newer than the last applied one (resolved 2, 1, 3)", async () => {
      const reqs = [deferred(), deferred(), deferred()];
      const queue = [...reqs];
      svc.getTotes = () => queue.shift().promise;

      await mount(); // request 1
      await change(svc.channels[0]); // request 2
      await change(svc.channels[0]); // request 3

      reqs[1].resolve(cloud(["Two"]));
      await flush();
      expect(probe()).toHaveTextContent("Two");
      expect(probe()).toHaveAttribute("data-loading", "false");

      reqs[0].resolve(cloud(["One"]));
      await flush();
      expect(probe()).toHaveTextContent("Two"); // older: ignored

      reqs[2].resolve(cloud(["Three"]));
      await flush();
      expect(probe()).toHaveTextContent("Three"); // newer than 2: applied
    });

    it("is not starved by a newer request that hangs: an older success still applies", async () => {
      const reqs = [deferred(), deferred(), deferred()];
      const queue = [...reqs];
      svc.getTotes = () => queue.shift().promise;

      await mount(); // request 1
      await change(svc.channels[0]); // request 2 (will hang for a while)
      await change(svc.channels[0]); // request 3 (hangs forever)

      reqs[0].resolve(cloud(["One"]));
      await flush();
      expect(probe()).toHaveTextContent("One");
      expect(probe()).toHaveAttribute("data-loading", "false");
      expect(probe()).toHaveAttribute("data-refreshing", "false");
      expect(probe()).toHaveAttribute("data-synced", String(Date.now()));

      reqs[1].resolve(cloud(["Two"]));
      await flush();
      expect(probe()).toHaveTextContent("Two");
    });
  });

  describe("a refetch that falls back to the cache", () => {
    it("keeps the cloud data on screen, flags the link, and retries with backoff", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      expect(probe()).toHaveAttribute("data-source", "cloud");
      expect(probe()).toHaveAttribute("data-connection", "live");
      const syncedBefore = probe().getAttribute("data-synced");
      expect(syncedBefore).toBe(String(Date.now()));

      // Radio not ready yet: getTotes falls back to the (older, photo-less) cache
      svc.getTotes = async () => {
        fetchCount += 1;
        return cache([]);
      };
      vi.setSystemTime(new Date("2026-11-08T12:05:00Z"));
      await change(svc.channels[0]);
      expect(fetchCount).toBe(2);
      expect(probe()).toHaveTextContent("Camping"); // not replaced by []
      expect(probe()).toHaveAttribute("data-source", "cloud");
      expect(probe()).toHaveAttribute("data-synced", syncedBefore);
      expect(probe()).toHaveAttribute("data-connection", "connecting");
      expect(statusText()).toBe("Reconnecting…");

      // Retry 2 s later still fails → 4 s → then the cloud is back
      await advance(1999);
      expect(fetchCount).toBe(2);
      await advance(1);
      expect(fetchCount).toBe(3);
      expect(probe()).toHaveTextContent("Camping");
      await advance(3999);
      expect(fetchCount).toBe(3);

      svc.getTotes = async () => {
        fetchCount += 1;
        return cloud(["Camping", "Tools"]);
      };
      await advance(1);
      expect(fetchCount).toBe(4);
      expect(probe()).toHaveTextContent("Camping,Tools");
      expect(probe()).toHaveAttribute("data-connection", "live"); // channel never dropped
      expect(probe()).toHaveAttribute("data-synced", String(Date.now()));

      // Success stops the retry loop
      await advance(60 * 1000);
      expect(fetchCount).toBe(4);
    });

    it("reports offline (not reconnecting) when the browser says there is no network", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      svc.getTotes = async () => cache([]);
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      await change(svc.channels[0]);
      expect(probe()).toHaveTextContent("Camping");
      expect(probe()).toHaveAttribute("data-connection", "offline");
      expect(statusText()).toMatch(/^Offline — showing the copy from /);
    });

    it("still shows the cached copy on a cold start, with the time it was synced", async () => {
      const syncedAt = new Date("2026-11-08T09:10:00Z").getTime();
      localStorage.setItem(SYNCED_AT_KEY, String(syncedAt));
      svc.getTotes = async () => {
        fetchCount += 1;
        return cache(["Camping"]);
      };

      await mount();
      expect(probe()).toHaveTextContent("Camping");
      expect(probe()).toHaveAttribute("data-source", "cache");
      expect(probe()).toHaveAttribute("data-loading", "false");
      expect(probe()).toHaveAttribute("data-synced", String(syncedAt));
      expect(statusText()).toBe(
        `Offline — showing the copy from ${formatTimeOfDay(syncedAt)}`
      );

      // Keeps trying; the first cloud success replaces the copy and the time
      svc.getTotes = async () => {
        fetchCount += 1;
        return cloud(["Camping", "Tools"]);
      };
      await advance(2000);
      expect(probe()).toHaveTextContent("Camping,Tools");
      expect(probe()).toHaveAttribute("data-source", "cloud");
      expect(probe()).toHaveAttribute("data-synced", String(Date.now()));
    });

    it("lets a slower cloud response replace a cached copy that arrived after it started", async () => {
      const slowCloud = deferred();
      const fastCache = deferred();
      const queue = [slowCloud, fastCache];
      svc.getTotes = () => queue.shift().promise;

      await mount(); // request 1: cloud, slow
      await change(svc.channels[0]); // request 2: falls back to the cache, fast

      fastCache.resolve(cache(["Old copy"]));
      await flush();
      expect(probe()).toHaveTextContent("Old copy");
      expect(probe()).toHaveAttribute("data-source", "cache");
      expect(probe()).toHaveAttribute("data-loading", "false");

      slowCloud.resolve(cloud(["Camping"]));
      await flush();
      expect(probe()).toHaveTextContent("Camping"); // cloud beats its own mirror
      expect(probe()).toHaveAttribute("data-source", "cloud");
    });

    it("ignores a corrupt persisted sync time", async () => {
      localStorage.setItem(SYNCED_AT_KEY, "not-a-number");
      svc.getTotes = async () => cache(["Camping"]);
      await mount();
      expect(probe()).toHaveAttribute("data-synced", "");
      expect(statusText()).toBe("Offline — showing the last saved copy");
    });
  });

  it("records lastSyncedAt only for a successful cloud fetch and persists it", async () => {
    await mount();
    expect(probe()).toHaveAttribute("data-source", "cloud");
    expect(probe()).toHaveAttribute("data-synced", String(Date.now()));
    expect(localStorage.getItem(SYNCED_AT_KEY)).toBe(String(Date.now()));
  });

  it("maps channel statuses and network events onto connection", async () => {
    await mount();
    expect(probe()).toHaveAttribute("data-connection", "connecting");

    await status(svc.channels[0], "SUBSCRIBED");
    expect(probe()).toHaveAttribute("data-connection", "live");

    await status(svc.channels[0], "CLOSED");
    expect(probe()).toHaveAttribute("data-connection", "connecting");

    await fireWindow("offline");
    expect(probe()).toHaveAttribute("data-connection", "offline");

    await fireWindow("online");
    expect(probe()).toHaveAttribute("data-connection", "connecting");
  });

  it("restores 'live' after an offline/online blip when the channel never dropped", async () => {
    await mount();
    await status(svc.channels[0], "SUBSCRIBED");
    await fireWindow("offline");
    expect(probe()).toHaveAttribute("data-connection", "offline");
    await fireWindow("online");
    await flush();
    expect(probe()).toHaveAttribute("data-connection", "live");
    expect(svc.channels).toHaveLength(1); // no needless resubscribe
  });

  describe("coming back to the foreground", () => {
    it("does not refetch when the data is fresh and the channel is live", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      expect(fetchCount).toBe(1);

      await advance(10 * 1000);
      await fireVisible();
      await flush();
      expect(fetchCount).toBe(1);
    });

    it("refetches in the background when the last sync is older than 30 s", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      expect(fetchCount).toBe(1);

      await advance(31 * 1000);
      await fireVisible();
      await flush();
      expect(fetchCount).toBe(2);
      expect(probe()).toHaveAttribute("data-refreshing", "false"); // background
    });

    it("refetches and reconnects at once when the channel is down, even if the data is fresh", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      await status(svc.channels[0], "CHANNEL_ERROR");
      expect(svc.channels).toHaveLength(1);

      await fireVisible();
      await flush();
      expect(fetchCount).toBe(2);
      expect(svc.channels).toHaveLength(2); // no waiting out the backoff
      expect(svc.removed).toContain(svc.channels[0]);
    });

    it("rebuilds a 'live' channel after a long sleep, since iOS may have killed the socket silently", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      expect(probe()).toHaveAttribute("data-connection", "live");

      await setVisibility("hidden");
      await advance(31 * 1000);
      // No CLOSED / CHANNEL_ERROR ever arrived while asleep
      await setVisibility("visible");

      expect(fetchCount).toBe(2); // stale data refetched right away
      expect(svc.channels).toHaveLength(2); // old channel not trusted
      expect(svc.removed).toEqual([svc.channels[0]]);
      expect(probe()).toHaveAttribute("data-connection", "connecting");
      expect(statusText()).toBe("Reconnecting…");

      // The new channel confirms we are live and catches up once more
      await status(svc.channels[1], "SUBSCRIBED");
      expect(probe()).toHaveAttribute("data-connection", "live");
      expect(fetchCount).toBe(3);

      // Late statuses from the abandoned channel are ignored
      await status(svc.channels[0], "CLOSED");
      expect(probe()).toHaveAttribute("data-connection", "live");
      await advance(60 * 1000);
      expect(svc.channels).toHaveLength(2);
    });

    it("keeps the channel after a short trip to the background", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      await setVisibility("hidden");
      await advance(10 * 1000);
      await setVisibility("visible");
      expect(fetchCount).toBe(1);
      expect(svc.channels).toHaveLength(1);
      expect(probe()).toHaveAttribute("data-connection", "live");
    });

    it("ignores the event when the page is being hidden", async () => {
      await mount();
      await status(svc.channels[0], "CLOSED");
      await setVisibility("hidden");
      await flush();
      expect(fetchCount).toBe(1);
      expect(svc.channels).toHaveLength(1);
    });
  });

  it("refetches when the network comes back", async () => {
    await mount();
    await status(svc.channels[0], "SUBSCRIBED");
    expect(fetchCount).toBe(1);
    await fireWindow("online");
    await flush();
    expect(fetchCount).toBe(2);
  });

  describe("resubscribing after the channel drops", () => {
    it("catches up when realtime-js rejoins the SAME channel after an error", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      expect(fetchCount).toBe(1);

      await status(svc.channels[0], "CHANNEL_ERROR");
      expect(probe()).toHaveAttribute("data-connection", "connecting");

      // The socket reopens before our 1 s backoff fires; the channel rejoins
      await status(svc.channels[0], "SUBSCRIBED");
      expect(probe()).toHaveAttribute("data-connection", "live");
      expect(fetchCount).toBe(2); // exactly one catch-up fetch
      expect(svc.channels).toHaveLength(1);

      // Our pending resubscribe was cancelled, and a repeat SUBSCRIBED with
      // no drop in between does not refetch again
      await advance(60 * 1000);
      expect(svc.channels).toHaveLength(1);
      await status(svc.channels[0], "SUBSCRIBED");
      expect(fetchCount).toBe(2);
    });

    it("does not catch up on the very first SUBSCRIBED (the initial load already ran)", async () => {
      await mount();
      await status(svc.channels[0], "SUBSCRIBED");
      await flush();
      expect(fetchCount).toBe(1);
    });

    it("backs off 1 s → 2 s → 4 s … capped at 30 s, resets after SUBSCRIBED, and cleans up the old channel", async () => {
      await mount();
      expect(svc.channels).toHaveLength(1);

      await status(svc.channels[0], "CHANNEL_ERROR");
      await advance(999);
      expect(svc.channels).toHaveLength(1);
      await advance(1);
      expect(svc.channels).toHaveLength(2);
      expect(svc.removed).toEqual([svc.channels[0]]);

      await status(svc.channels[1], "TIMED_OUT");
      await advance(1999);
      expect(svc.channels).toHaveLength(2);
      await advance(1);
      expect(svc.channels).toHaveLength(3);

      await status(svc.channels[2], "CLOSED");
      await advance(4000);
      expect(svc.channels).toHaveLength(4);
      await status(svc.channels[3], "CLOSED");
      await advance(8000);
      expect(svc.channels).toHaveLength(5);
      await status(svc.channels[4], "CLOSED");
      await advance(16000);
      expect(svc.channels).toHaveLength(6);
      await status(svc.channels[5], "CLOSED");
      await advance(29999);
      expect(svc.channels).toHaveLength(6);
      await advance(1);
      expect(svc.channels).toHaveLength(7); // capped at 30 s
      await status(svc.channels[6], "CLOSED");
      await advance(30000);
      expect(svc.channels).toHaveLength(8); // still capped

      // Success resets the backoff and catches up on anything missed
      const fetchesBefore = fetchCount;
      await status(svc.channels[7], "SUBSCRIBED");
      await flush();
      expect(probe()).toHaveAttribute("data-connection", "live");
      expect(fetchCount).toBe(fetchesBefore + 1);

      await status(svc.channels[7], "CLOSED");
      await advance(1000);
      expect(svc.channels).toHaveLength(9);
    });

    it("ignores statuses from a channel that has already been replaced", async () => {
      await mount();
      await status(svc.channels[0], "CHANNEL_ERROR");
      await advance(1000);
      expect(svc.channels).toHaveLength(2);
      await status(svc.channels[1], "SUBSCRIBED");
      expect(probe()).toHaveAttribute("data-connection", "live");

      // Our own leave of the old channel reports CLOSED — must not count
      await status(svc.channels[0], "CLOSED");
      expect(probe()).toHaveAttribute("data-connection", "live");
      await advance(60 * 1000);
      expect(svc.channels).toHaveLength(2);
    });

    it("does not schedule a second retry while one is pending", async () => {
      await mount();
      await status(svc.channels[0], "CHANNEL_ERROR");
      await status(svc.channels[0], "CLOSED");
      await advance(1000);
      expect(svc.channels).toHaveLength(2);
      await advance(60 * 1000);
      expect(svc.channels).toHaveLength(2);
    });

    it("stops retrying and leaves the channel on unmount", async () => {
      const { unmount } = render(
        <ToteProvider>
          <Probe />
        </ToteProvider>
      );
      await flush();
      await status(svc.channels[0], "CHANNEL_ERROR");
      unmount();
      expect(svc.removed).toContain(svc.channels[0]);
      await advance(60 * 1000);
      expect(svc.channels).toHaveLength(1);
    });

    it("stops the fetch retry loop on unmount", async () => {
      svc.getTotes = async () => {
        fetchCount += 1;
        return cache([]);
      };
      const { unmount } = render(
        <ToteProvider>
          <Probe />
        </ToteProvider>
      );
      await flush();
      expect(fetchCount).toBe(1);
      unmount();
      await advance(60 * 1000);
      expect(fetchCount).toBe(1);
    });
  });
});
