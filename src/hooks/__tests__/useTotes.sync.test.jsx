import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ToteProvider, useTotes } from "../useTotes";

function Probe() {
  const { totes, lastSyncedAt, connection, source, loading, refreshing } =
    useTotes();
  return (
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
  );
}

const probe = () => screen.getByTestId("probe");
const cloud = (names) => ({
  data: names.map((name, i) => ({ id: i + 1, name, position: `A${i + 1}`, items: [] })),
  source: "cloud",
  layout: null,
});

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
    vi.useRealTimers();
  });

  it("applies only the newest fetch: a slow older response never overwrites newer data", async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    svc.getTotes = () => queue.shift().promise;

    await mount();
    expect(probe()).toHaveAttribute("data-loading", "true");

    // A realtime event arrives while the initial load is still in flight
    await act(async () => {
      svc.channels[0].onChange({});
    });

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

  it("records lastSyncedAt only for a successful cloud fetch", async () => {
    await mount();
    expect(probe()).toHaveAttribute("data-source", "cloud");
    expect(probe()).toHaveAttribute("data-synced", String(Date.now()));

    svc.getTotes = async () => ({ data: [], source: "cache", layout: null });
    const before = probe().getAttribute("data-synced");
    vi.setSystemTime(new Date("2026-11-08T12:05:00Z"));
    await act(async () => {
      svc.channels[0].onChange({});
    });
    await flush();
    expect(probe()).toHaveAttribute("data-source", "cache");
    expect(probe()).toHaveAttribute("data-synced", before);
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

    it("ignores the event when the page is being hidden", async () => {
      await mount();
      await status(svc.channels[0], "CLOSED");
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      try {
        await fireVisible();
        await flush();
      } finally {
        delete document.visibilityState;
      }
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
  });
});
