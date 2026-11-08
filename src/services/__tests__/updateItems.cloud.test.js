import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, adjustQty } from "../../utils/itemOps";

// ---------------------------------------------------------------------------
// Cloud mode. The test alias normally forces `supabase = null`; here we swap
// in a tiny in-memory fake of the supabase-js query builder that supports
// exactly the calls toteService makes. `beforeUpdate` lets a test play the
// OTHER phone writing between our read and our compare-and-swap update.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => ({ current: null }));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args) => fake.current.from(...args),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (name) => ({ data: { publicUrl: `https://cdn.test/${name}` } }),
      }),
    },
  },
}));

// compressImage needs a canvas; the migration test only cares about the row
vi.mock("../../utils/images", () => ({ compressImage: async (file) => file }));

function matches(row, filters) {
  return filters.every(([kind, col, val]) =>
    kind === "is" ? (val === null ? row[col] == null : row[col] === val) : row[col] === val
  );
}

function pick(row, cols) {
  if (!cols || cols.trim() === "*") return { ...row };
  const out = {};
  cols.split(",").forEach((c) => {
    out[c.trim()] = row[c.trim()];
  });
  return out;
}

function makeFakeSupabase(rows, { beforeUpdate } = {}) {
  const state = { rows: rows.map((r) => ({ ...r })), updates: [], failReads: false };

  function builder() {
    const q = { action: "select", cols: "*", payload: null, filters: [], single: null };
    const exec = async () => {
      if (q.action === "select") {
        if (state.failReads) return { data: null, error: new Error("Failed to fetch") };
        const data = state.rows.filter((r) => matches(r, q.filters)).map((r) => pick(r, q.cols));
        return q.single ? { data: data[0] ?? null, error: null } : { data, error: null };
      }
      if (q.action === "update") {
        if (beforeUpdate) await beforeUpdate(state, q);
        state.updates.push({ payload: q.payload, filters: q.filters });
        const hit = state.rows.filter((r) => matches(r, q.filters));
        hit.forEach((r) => Object.assign(r, q.payload));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      throw new Error(`fake supabase: unsupported action ${q.action}`);
    };
    const api = {
      select(cols) {
        if (q.action === "select") q.cols = cols ?? "*";
        return api;
      },
      update(payload) {
        q.action = "update";
        q.payload = payload;
        return api;
      },
      eq(col, val) {
        q.filters.push(["eq", col, val]);
        return api;
      },
      is(col, val) {
        q.filters.push(["is", col, val]);
        return api;
      },
      maybeSingle() {
        q.single = "maybe";
        return api;
      },
      single() {
        q.single = true;
        return api;
      },
      order() {
        return api;
      },
      then(resolve, reject) {
        return exec().then(resolve, reject);
      },
    };
    return api;
  }

  return { client: { from: () => builder() }, state };
}

const T0 = "2026-01-01T00:00:00.000Z";
const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };
const baseRow = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [lantern],
  created_at: T0,
  updated_at: T0,
};

/** The other phone writes: new items + a newer stamp. */
function otherPhoneWrites(state, items) {
  const row = state.rows.find((r) => r.id === 1);
  row.items = items;
  row.updated_at = new Date(new Date(row.updated_at || T0).getTime() + 1000).toISOString();
}

let toteService;

describe("toteService.updateItems (cloud mode, compare-and-swap)", () => {
  beforeEach(async () => {
    ({ toteService } = await import("../toteService"));
  });

  it("reads the fresh row, applies the op, and only writes if updated_at still matches", async () => {
    const { client, state } = makeFakeSupabase([baseRow]);
    fake.current = client;

    const saved = await toteService.updateItems(1, adjustQty("i1", 1));

    expect(saved.items).toEqual([{ ...lantern, qty: 3 }]);
    expect(saved.name).toBe("Camping Gear");
    expect(state.updates).toHaveLength(1);
    const { payload, filters } = state.updates[0];
    expect(Object.keys(payload).sort()).toEqual(["items", "updated_at"]);
    expect(filters).toContainEqual(["eq", "id", 1]);
    expect(filters).toContainEqual(["eq", "updated_at", T0]);
    expect(new Date(payload.updated_at) > new Date(T0)).toBe(true);
  });

  it("two phones: A adds an item while B adjusts a qty → both survive (retry path)", async () => {
    // Phone B (us) reads [Lantern]; before our write lands, phone A adds Rope.
    let raced = false;
    const { client, state } = makeFakeSupabase([baseRow], {
      beforeUpdate: (st) => {
        if (!raced) {
          raced = true;
          otherPhoneWrites(st, [lantern, rope]);
        }
      },
    });
    fake.current = client;

    const saved = await toteService.updateItems(1, adjustQty("i1", 1));

    expect(state.updates).toHaveLength(2); // first attempt matched 0 rows
    expect(saved.items).toEqual([{ ...lantern, qty: 3 }, rope]);
    expect(state.rows[0].items).toEqual([{ ...lantern, qty: 3 }, rope]);
  });

  it("gives up after 3 attempts with a friendly message when it keeps losing the race", async () => {
    const { client, state } = makeFakeSupabase([baseRow], {
      beforeUpdate: (st) => otherPhoneWrites(st, [...st.rows[0].items]),
    });
    fake.current = client;

    await expect(toteService.updateItems(1, adjustQty("i1", 1))).rejects.toThrow(
      /someone else is editing/i
    );
    expect(state.updates).toHaveLength(3);
    // Nothing of ours was ever written
    expect(state.rows[0].items).toEqual([lantern]);
  });

  it("matches with IS NULL when the row has no updated_at yet", async () => {
    const { client, state } = makeFakeSupabase([{ ...baseRow, updated_at: null }]);
    fake.current = client;

    const saved = await toteService.updateItems(1, addItem(rope));

    expect(saved.items).toEqual([lantern, rope]);
    expect(state.updates[0].filters).toContainEqual(["is", "updated_at", null]);
    expect(typeof state.updates[0].payload.updated_at).toBe("string");
  });

  it("stamps strictly later than the stamp it read, even if the other phone's clock is ahead", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { client, state } = makeFakeSupabase([{ ...baseRow, updated_at: future }]);
    fake.current = client;

    await toteService.updateItems(1, adjustQty("i1", 1));

    expect(new Date(state.updates[0].payload.updated_at) > new Date(future)).toBe(true);
  });

  it("throws a friendly not-found error for an unknown id (no retries)", async () => {
    const { client, state } = makeFakeSupabase([baseRow]);
    fake.current = client;

    await expect(toteService.updateItems(42, addItem(rope))).rejects.toThrow(/find that tote/i);
    expect(state.updates).toHaveLength(0);
  });

  it("wraps read failures in the existing friendly save error", async () => {
    const { client, state } = makeFakeSupabase([baseRow]);
    state.failReads = true;
    fake.current = client;

    await expect(toteService.updateItems(1, addItem(rope))).rejects.toThrow(
      /wasn't saved|couldn't save your changes/i
    );
  });

  it("never lets a stale snapshot through: whole-array semantics are gone", async () => {
    // Two edits queued back-to-back from stale closures both land
    const { client, state } = makeFakeSupabase([baseRow]);
    fake.current = client;

    await Promise.all([
      toteService.updateItems(1, addItem(rope)),
      toteService.updateItems(1, adjustQty("i1", -2)),
    ]);
    expect(state.rows[0].items).toEqual([{ ...lantern, qty: 0 }, rope]);
  });
});

describe("toteService.migrateEmbeddedPhotos (cloud mode)", () => {
  beforeEach(async () => {
    ({ toteService } = await import("../toteService"));
  });

  it("only swaps the photo of the migrated items — a concurrent rename and item edit survive", async () => {
    const dataUri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const snapshot = {
      ...baseRow,
      name: "Old Name",
      items: [{ ...lantern, image: dataUri }, rope],
    };
    // By the time Tidy Up runs, the other phone renamed the tote, moved it,
    // bumped Rope, and added Glue.
    const glue = { id: "i3", name: "Glue", qty: 1 };
    const liveRow = {
      ...snapshot,
      name: "New Name",
      position: "C4",
      items: [{ ...lantern, image: dataUri }, { ...rope, qty: 5 }, glue],
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    const { client, state } = makeFakeSupabase([liveRow]);
    fake.current = client;

    const moved = await toteService.migrateEmbeddedPhotos([snapshot]);

    expect(moved).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].payload).sort()).toEqual(["items", "updated_at"]);

    const row = state.rows[0];
    expect(row.name).toBe("New Name");
    expect(row.position).toBe("C4");
    expect(row.items.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(row.items[0].image).toMatch(/^https:\/\/cdn\.test\/migrated-1-i1-/);
    expect(row.items[1]).toEqual({ ...rope, qty: 5 });
    expect(row.items[2]).toEqual(glue);
  });
});
