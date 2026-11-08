import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Photo prefetch after a CLOUD load. The service is faked (cloud mode); the
// prefetch call is spied on, so no service worker is needed.

const svc = vi.hoisted(() => ({ getTotes: null, mode: "cloud", prefetch: null }));

vi.mock("../../services/toteService", () => ({
  get storageMode() {
    return svc.mode;
  },
  NO_CAPABILITIES: Object.freeze({ tags: false, notes: false, swap: false }),
  UserFacingError: class UserFacingError extends Error {},
  migrateLocalToSupabase: async () => {},
  toteService: {
    getTotes: (...args) => svc.getTotes(...args),
    subscribeToChanges: () => ({}),
    unsubscribeFromChanges: () => {},
  },
}));
vi.mock("../../utils/photoPrefetch", () => ({
  prefetchPhotos: (...args) => svc.prefetch(...args),
}));

import { ToteProvider, useTotes } from "../useTotes";

let reload;
function Probe() {
  reload = useTotes().loadData;
  return null;
}

const tote = (id, position, images, extra = {}) => ({
  id,
  name: `Tote ${id}`,
  position,
  items: images.map((image, i) => ({ id: `${id}-${i}`, name: `Item ${i}`, image })),
  ...extra,
});

const reply = (data, source = "cloud") => ({ data, source, layout: null });

describe("useTotes photo prefetch", () => {
  beforeEach(() => {
    svc.mode = "cloud";
    svc.prefetch = vi.fn((urls) => urls.length);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefetches the photos of visible totes once, then only new URLs", async () => {
    svc.getTotes = vi.fn().mockResolvedValue(
      reply([
        tote(1, "A1", ["https://x.co/a.jpg", "https://x.co/b.jpg", null]),
        tote(2, "A2", ["https://x.co/a.jpg", "data:image/jpeg;base64,AAAA"]),
        tote(3, "__config__", ["https://x.co/hidden.jpg"]),
      ])
    );
    render(
      <ToteProvider>
        <Probe />
      </ToteProvider>
    );
    await waitFor(() => expect(svc.prefetch).toHaveBeenCalledTimes(1));
    expect(svc.prefetch.mock.calls[0][0].sort()).toEqual([
      "https://x.co/a.jpg",
      "https://x.co/b.jpg",
    ]);

    // Same photos again (e.g. a realtime reload): nothing new, no call
    await act(() => reload({ background: true }));
    expect(svc.prefetch).toHaveBeenCalledTimes(1);

    // A new photo appears: only that URL is sent
    svc.getTotes = vi.fn().mockResolvedValue(
      reply([
        tote(1, "A1", ["https://x.co/a.jpg", "https://x.co/b.jpg"]),
        tote(4, "A3", ["https://x.co/new.jpg"]),
      ])
    );
    await act(() => reload({ background: true }));
    await waitFor(() => expect(svc.prefetch).toHaveBeenCalledTimes(2));
    expect(svc.prefetch.mock.calls[1][0]).toEqual(["https://x.co/new.jpg"]);
  });

  it("skips photos of a duplicate row hidden behind the newest tote of a spot", async () => {
    svc.getTotes = vi.fn().mockResolvedValue(
      reply([
        tote(1, "A1", ["https://x.co/old.jpg"], { updated_at: "2026-01-01T00:00:00Z" }),
        tote(2, "A1", ["https://x.co/new.jpg"], { updated_at: "2026-06-01T00:00:00Z" }),
      ])
    );
    render(
      <ToteProvider>
        <Probe />
      </ToteProvider>
    );
    await waitFor(() => expect(svc.prefetch).toHaveBeenCalledTimes(1));
    expect(svc.prefetch.mock.calls[0][0]).toEqual(["https://x.co/new.jpg"]);
  });

  it("does not prefetch from the offline cache copy", async () => {
    svc.getTotes = vi
      .fn()
      .mockResolvedValue(reply([tote(1, "A1", ["https://x.co/a.jpg"])], "cache"));
    render(
      <ToteProvider>
        <Probe />
      </ToteProvider>
    );
    await waitFor(() => expect(svc.getTotes).toHaveBeenCalled());
    await act(async () => {});
    expect(svc.prefetch).not.toHaveBeenCalled();
  });

  it("never prefetches in local mode", async () => {
    svc.mode = "local";
    svc.getTotes = vi
      .fn()
      .mockResolvedValue(reply([tote(1, "A1", ["https://x.co/a.jpg"])], "local"));
    render(
      <ToteProvider>
        <Probe />
      </ToteProvider>
    );
    await waitFor(() => expect(svc.getTotes).toHaveBeenCalled());
    await act(async () => {});
    expect(svc.prefetch).not.toHaveBeenCalled();
  });

  it("retries URLs the service worker could not take yet", async () => {
    svc.prefetch = vi.fn(() => 0); // no controlling worker yet
    svc.getTotes = vi
      .fn()
      .mockResolvedValue(reply([tote(1, "A1", ["https://x.co/a.jpg"])]));
    render(
      <ToteProvider>
        <Probe />
      </ToteProvider>
    );
    await waitFor(() => expect(svc.prefetch).toHaveBeenCalledTimes(1));

    svc.prefetch.mockImplementation((urls) => urls.length); // worker took over
    await act(() => reload({ background: true }));
    await waitFor(() => expect(svc.prefetch).toHaveBeenCalledTimes(2));
    expect(svc.prefetch.mock.calls[1][0]).toEqual(["https://x.co/a.jpg"]);
  });
});
