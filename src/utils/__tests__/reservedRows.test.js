import { describe, expect, it } from "vitest";
import {
  appendRemovedEntries,
  isExpired,
  isReservedPosition,
  makeRemovedEntries,
  parseTombstone,
  pruneRemovedEntries,
  removedEntriesFromRows,
  stripEmbeddedImage,
  toDeletedEntry,
  tombstonePosition,
} from "../reservedRows";

const DAY = 24 * 60 * 60 * 1000;

describe("removed entries never keep embedded photos", () => {
  const dataUri = `data:image/jpeg;base64,${"a".repeat(64)}`;
  const tote = { id: 1, name: "Camping Gear", position: "B3" };

  it("makeRemovedEntries nulls a data-URI image but keeps storage URLs", () => {
    const [a, b, c] = makeRemovedEntries(
      tote,
      [
        { id: "x", name: "Vase", image: dataUri },
        { id: "y", name: "Bowl", image: "https://cdn.example/bowl.jpg" },
        { id: "z", name: "Lights" },
      ],
      "2026-02-01T00:00:00.000Z"
    );
    expect(a.item).toEqual({ id: "x", name: "Vase", image: null });
    expect(b.item.image).toBe("https://cdn.example/bowl.jpg");
    expect(c.item).toEqual({ id: "z", name: "Lights" });
    expect(JSON.stringify([a, b, c])).not.toContain("data:");
  });

  it("stripEmbeddedImage is a no-op for non-embedded images", () => {
    const item = { id: "y", image: "https://cdn.example/bowl.jpg" };
    expect(stripEmbeddedImage(item)).toBe(item);
    expect(stripEmbeddedImage(null)).toBeNull();
  });
});

describe("reserved positions", () => {
  it("anything starting with __ is reserved", () => {
    expect(isReservedPosition("__config__")).toBe(true);
    expect(isReservedPosition("__deleted__:A1:3")).toBe(true);
    expect(isReservedPosition("__anything")).toBe(true);
    expect(isReservedPosition("A1")).toBe(false);
    expect(isReservedPosition("_A1")).toBe(false);
    expect(isReservedPosition(null)).toBe(false);
    expect(isReservedPosition(undefined)).toBe(false);
  });

  it("tombstone positions round-trip and are unique per tote", () => {
    expect(tombstonePosition("LW3", 42)).toBe("__deleted__:LW3:42");
    expect(parseTombstone("__deleted__:LW3:42")).toEqual({ originalPosition: "LW3", idSegment: "42" });
    expect(tombstonePosition("A1", 1)).not.toBe(tombstonePosition("A1", 2));
    expect(parseTombstone("__deleted__:nocolon")).toBeNull();
    expect(parseTombstone("__config__")).toBeNull();
    expect(parseTombstone("A1")).toBeNull();
  });

  it("toDeletedEntry uses the row id, not the position segment", () => {
    const row = {
      id: 42,
      name: "Old",
      position: "__deleted__:A1:999",
      items: [{ id: 1 }],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    expect(toDeletedEntry(row)).toEqual({
      id: 42,
      name: "Old",
      originalPosition: "A1",
      deletedAt: "2026-02-01T00:00:00.000Z",
      items: [{ id: 1 }],
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(toDeletedEntry({ id: 1, position: "A1" })).toBeNull();
  });

  it("isExpired: 30 days, unknown dates are never expired", () => {
    const now = Date.now();
    expect(isExpired(new Date(now - 31 * DAY).toISOString(), now)).toBe(true);
    expect(isExpired(new Date(now - 29 * DAY).toISOString(), now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired("garbage", now)).toBe(false);
  });
});

describe("removed-items entries", () => {
  const tote = { id: 3, name: "Paint", position: "A1" };
  const now = Date.now();
  const at = (daysBack) => new Date(now - daysBack * DAY).toISOString();

  it("makeRemovedEntries builds the entry shape", () => {
    const [e] = makeRemovedEntries(tote, [{ id: "x", name: "Brush" }, null], at(0));
    expect(e).toEqual({
      id: `3:x:${at(0)}`,
      item: { id: "x", name: "Brush" },
      toteId: 3,
      toteName: "Paint",
      position: "A1",
      removedAt: at(0),
    });
  });

  it("appendRemovedEntries is idempotent and prunes", () => {
    const fresh = makeRemovedEntries(tote, [{ id: "x" }], at(0));
    const stale = makeRemovedEntries(tote, [{ id: "s" }], at(31));
    const op = appendRemovedEntries(fresh, now);
    const once = op([...stale]);
    expect(once.map((e) => e.item.id)).toEqual(["x"]);
    expect(op(once)).toEqual(once);
  });

  it("pruneRemovedEntries drops junk, sorts newest first, caps at 200", () => {
    const entries = Array.from({ length: 205 }, (_, i) =>
      makeRemovedEntries(tote, [{ id: i }], at(i / 100))[0]
    );
    const out = pruneRemovedEntries([null, { id: "bad" }, ...entries.reverse()], now);
    expect(out).toHaveLength(200);
    expect(out[0].item.id).toBe(0);
    expect(out[199].item.id).toBe(199);
  });

  it("removedEntriesFromRows merges every bin row and ignores others", () => {
    const rows = [
      { position: "A1", items: [{ id: "not-an-entry" }] },
      { position: "__removed_items__", items: makeRemovedEntries(tote, [{ id: 1 }], at(1)) },
      { position: "__removed_items__", items: makeRemovedEntries(tote, [{ id: 2 }], at(0)) },
    ];
    expect(removedEntriesFromRows(rows, now).map((e) => e.item.id)).toEqual([2, 1]);
  });
});
