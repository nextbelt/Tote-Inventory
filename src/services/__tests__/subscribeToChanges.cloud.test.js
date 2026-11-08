import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Cloud mode: a tiny fake of the supabase-js realtime surface that records
// channels, bindings and status callbacks so we can verify the wiring that
// the ToteProvider's reconnect logic depends on.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => ({ channels: [], removed: [], removeResult: null }));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    channel(topic) {
      const ch = {
        topic,
        bindings: [],
        statusCb: null,
        on(type, filter, cb) {
          this.bindings.push({ type, filter, cb });
          return this;
        },
        subscribe(cb) {
          this.statusCb = cb;
          return this;
        },
        unsubscribe: vi.fn(async () => "ok"),
      };
      fake.channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      fake.removed.push(ch);
      return fake.removeResult ? fake.removeResult() : Promise.resolve("ok");
    },
    from() {
      throw new Error("not used here");
    },
    storage: { from: () => ({}) },
  },
}));

vi.mock("../../utils/images", () => ({ compressImage: async (file) => file }));

import { toteService } from "../toteService";

describe("toteService.subscribeToChanges (cloud)", () => {
  beforeEach(() => {
    fake.channels = [];
    fake.removed = [];
    fake.removeResult = null;
  });

  it("listens to every change on the totes table and forwards channel statuses", () => {
    const onChange = vi.fn();
    const onStatus = vi.fn();
    const channel = toteService.subscribeToChanges(onChange, onStatus);

    expect(channel).toBe(fake.channels[0]);
    expect(channel.bindings).toEqual([
      {
        type: "postgres_changes",
        filter: { event: "*", schema: "public", table: "totes" },
        cb: onChange,
      },
    ]);

    channel.statusCb("SUBSCRIBED");
    channel.statusCb("CHANNEL_ERROR", new Error("boom"));
    channel.statusCb("TIMED_OUT");
    channel.statusCb("CLOSED");
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual([
      "SUBSCRIBED",
      "CHANNEL_ERROR",
      "TIMED_OUT",
      "CLOSED",
    ]);
    expect(onStatus.mock.calls[1][1]).toBeInstanceOf(Error);
  });

  it("uses a fresh topic per subscription so a resubscribe never re-joins a channel still leaving", () => {
    const a = toteService.subscribeToChanges(() => {});
    const b = toteService.subscribeToChanges(() => {});
    expect(a.topic).toMatch(/^totes_changes/);
    expect(b.topic).toMatch(/^totes_changes/);
    expect(a.topic).not.toBe(b.topic);
  });

  it("tolerates a missing or throwing status listener", () => {
    const silent = toteService.subscribeToChanges(() => {});
    expect(() => silent.statusCb("SUBSCRIBED")).not.toThrow();

    const noisy = toteService.subscribeToChanges(
      () => {},
      () => {
        throw new Error("listener bug");
      }
    );
    expect(() => noisy.statusCb("CLOSED")).not.toThrow();
  });

  it("unsubscribeFromChanges removes the channel from the client and swallows failures", async () => {
    const channel = toteService.subscribeToChanges(() => {});
    toteService.unsubscribeFromChanges(channel);
    expect(fake.removed).toEqual([channel]);

    fake.removeResult = () => Promise.reject(new Error("socket gone"));
    const other = toteService.subscribeToChanges(() => {});
    expect(() => toteService.unsubscribeFromChanges(other)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(() => toteService.unsubscribeFromChanges(null)).not.toThrow();
  });
});
