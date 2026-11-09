import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSwapRpc, makeFakeSupabase } from "../../test/fake-supabase";
import { addItem, adjustQty } from "../../utils/itemOps";

// ---------------------------------------------------------------------------
// Cloud mode for: capability detection, tags/notes, swap, soft delete /
// restore / purge, the removed-items bin. Each test gets a fresh module so
// the service's per-load memory (capabilities, bin row id) never leaks.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => ({ current: null }));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args) => fake.current.from(...args),
    rpc: (...args) => fake.current.rpc(...args),
    storage: { from: () => ({}) },
  },
}));

const T0 = "2026-01-01T00:00:00.000Z";
const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: 7, name: "Rope", qty: 1 }; // numeric item id (live data mixes both)
const camping = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [lantern, rope],
  created_at: T0,
  updated_at: T0,
};
const sports = {
  id: 2,
  name: "Sports",
  position: "C4",
  items: [],
  created_at: T0,
  updated_at: T0,
};
const withCols = (row) => ({ tags: [], notes: null, ...row });
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const flush = () => new Promise((r) => setTimeout(r, 0));

let toteService;
let splitConfig;

async function setup(rows, options) {
  const made = makeFakeSupabase(rows, options);
  fake.current = made.client;
  // Prime capability detection the way the app does: a load first
  const loaded = await toteService.getTotes();
  return { ...made, loaded };
}

beforeEach(async () => {
  vi.resetModules();
  ({ toteService, splitConfig } = await import("../toteService"));
});

describe("capability detection", () => {
  it("rows carrying tags/notes keys → all three capabilities", async () => {
    const { loaded } = await setup([withCols(camping)]);
    expect(loaded.source).toBe("cloud");
    expect(loaded.capabilities).toEqual({ tags: true, notes: true, swap: true });
  });

  it("rows without the keys → none (SQL not run yet)", async () => {
    const { loaded } = await setup([camping]);
    expect(loaded.capabilities).toEqual({ tags: false, notes: false, swap: false });
  });

  it("an empty table can't prove the columns exist → none", async () => {
    const { loaded } = await setup([]);
    expect(loaded.capabilities).toEqual({ tags: false, notes: false, swap: false });
  });

  it("offline: capabilities come from the cached rows", async () => {
    localStorage.setItem("totes-cache", JSON.stringify([withCols(camping)]));
    const { loaded } = await setup([], { failReads: true });
    expect(loaded.source).toBe("cache");
    expect(loaded.capabilities).toEqual({ tags: true, notes: true, swap: true });

    localStorage.setItem("totes-cache", JSON.stringify([camping]));
    const again = await toteService.getTotes();
    expect(again.capabilities.tags).toBe(false);
  });
});

describe("before the SQL is run (capabilities missing)", () => {
  it("tags/notes patches throw the setup error and send nothing", async () => {
    const { state } = await setup([camping]);
    await expect(toteService.updateTote(1, { tags: ["Camping"] })).rejects.toThrow(
      /one-time setup needed/i
    );
    await expect(toteService.updateTote(1, { notes: "lid cracked" })).rejects.toMatchObject({
      code: "SETUP_NEEDED",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("creating a tote with tags throws the setup error and inserts nothing", async () => {
    const { state } = await setup([camping]);
    await expect(
      toteService.saveTote({ name: "New", position: "A1", items: [], tags: ["x"] }, true)
    ).rejects.toThrow(/one-time setup/i);
    expect(state.inserts).toHaveLength(0);
  });

  it("swap throws the setup error without calling the function", async () => {
    const { state } = await setup([camping, sports]);
    await expect(toteService.swapTotes(1, 2)).rejects.toThrow(/one-time setup/i);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("everything else keeps working: a rename sends no unknown columns", async () => {
    const { state } = await setup([camping]);
    await toteService.updateTote(1, { name: "  Camp  " });
    expect(Object.keys(state.updates[0].payload).sort()).toEqual(["name", "updated_at"]);
    expect(state.updates[0].payload.name).toBe("Camp");
  });

  it("a missing database function (PGRST202) maps to the setup error", async () => {
    // Columns present but the function isn't (e.g. a half-applied script)
    await setup([withCols(camping), withCols(sports)]); // default rpc → PGRST202
    await expect(toteService.swapTotes(1, 2)).rejects.toThrow(/one-time setup/i);
  });
});

describe("tags and notes", () => {
  it("normalizes tags and notes before writing", async () => {
    const { state } = await setup([withCols(camping)]);
    const saved = await toteService.updateTote(1, {
      tags: [" Camping ", "camping", "Holiday   Lights", "", 42],
      notes: "  lid cracked \r\n",
    });
    expect(saved.tags).toEqual(["Camping", "Holiday Lights"]);
    expect(saved.notes).toBe("lid cracked");
    expect(Object.keys(state.updates[0].payload).sort()).toEqual([
      "notes",
      "tags",
      "updated_at",
    ]);
  });

  it("empty notes are stored as null", async () => {
    const { state } = await setup([withCols(camping)]);
    await toteService.updateTote(1, { notes: "   " });
    expect(state.updates[0].payload.notes).toBeNull();
  });

  it("rejects too many tags / too-long notes without writing", async () => {
    const { state } = await setup([withCols(camping)]);
    await expect(
      toteService.updateTote(1, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
    ).rejects.toThrow(/up to 10 tags/i);
    await expect(toteService.updateTote(1, { notes: "x".repeat(501) })).rejects.toThrow(
      /500 characters/i
    );
    expect(state.updates).toHaveLength(0);
  });

  it("new totes carry tags/notes only when given", async () => {
    const { state } = await setup([withCols(camping)]);
    await toteService.saveTote({ name: "A", position: "A1", items: [] }, true);
    expect(state.inserts[0]).not.toHaveProperty("tags");
    await toteService.saveTote(
      { name: "B", position: "A2", items: [], tags: ["Holiday"], notes: "x" },
      true
    );
    expect(state.inserts[1].tags).toEqual(["Holiday"]);
    expect(state.inserts[1].notes).toBe("x");
  });
});

describe("swapTotes", () => {
  it("calls swap_tote_positions with both ids (no expectations when none given) and returns [a, b] swapped", async () => {
    const { state } = await setup([withCols(camping), withCols(sports)], { rpc: fakeSwapRpc });
    const [a, b] = await toteService.swapTotes(2, 1);
    expect(state.rpcCalls).toEqual([
      { fn: "swap_tote_positions", args: { a_id: 2, b_id: 1, expect_a: null, expect_b: null } },
    ]);
    expect(a.id).toBe(2);
    expect(a.position).toBe("B3");
    expect(b.id).toBe(1);
    expect(b.position).toBe("C4");
    expect(new Date(a.updated_at) > new Date(T0)).toBe(true);
    expect(state.updates).toHaveLength(0); // no client-side position writes
  });

  it("refuses the same tote twice and surfaces a missing tote", async () => {
    const { state } = await setup([withCols(camping), withCols(sports)], { rpc: fakeSwapRpc });
    await expect(toteService.swapTotes(1, 1)).rejects.toThrow(/two different totes/i);
    await expect(toteService.swapTotes(1, 99)).rejects.toThrow(/no longer exists/i);
    expect(state.rpcCalls).toHaveLength(0); // the fresh read already said so
  });

  it("with the spots the user saw: refuses (TOTE_MOVED, naming the tote) before calling the function when a tote is elsewhere NOW — even though this phone's copy still had it there", async () => {
    // The other phone moved Sports from C4 to A1; this phone never heard
    // (channel reconnecting), so the user confirmed "swap with Sports (C4)"
    const { state } = await setup(
      [withCols(camping), withCols({ ...sports, position: "A1" })],
      { rpc: fakeSwapRpc }
    );
    await expect(
      toteService.swapTotes(1, 2, { expectA: "B3", expectB: "C4" })
    ).rejects.toMatchObject({
      code: "TOTE_MOVED",
      message: "“Sports” was moved on the other phone, so nothing was swapped.",
    });
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(state.rows.map((r) => r.position)).toEqual(["B3", "A1"]);

    // Our own tote moved → named too
    await expect(
      toteService.swapTotes(1, 2, { expectA: "C4", expectB: "A1" })
    ).rejects.toThrow(/“Camping Gear” was moved/);
    expect(state.rpcCalls).toHaveLength(0);

    // Right spots → the expectations travel to the function (checked again under its locks)
    const [a, b] = await toteService.swapTotes(1, 2, { expectA: "B3", expectB: "A1" });
    expect(state.rpcCalls).toEqual([
      { fn: "swap_tote_positions", args: { a_id: 1, b_id: 2, expect_a: "B3", expect_b: "A1" } },
    ]);
    expect(a.position).toBe("A1");
    expect(b.position).toBe("B3");
  });

  it("a tote moved between our read and the function's lock: the function refuses (SQLSTATE GT001) → TOTE_MOVED, nothing swapped", async () => {
    const { state } = await setup([withCols(camping), withCols(sports)], {
      rpc: (fn, args, st) => {
        st.rows.find((r) => r.id === 2).position = "A1"; // the other phone, just now
        return fakeSwapRpc(fn, args, st);
      },
    });
    await expect(
      toteService.swapTotes(1, 2, { expectA: "B3", expectB: "C4" })
    ).rejects.toMatchObject({ code: "TOTE_MOVED", message: /was moved on the other phone/ });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rows.find((r) => r.id === 1).position).toBe("B3");
    expect(state.rows.find((r) => r.id === 2).position).toBe("A1");
  });
});

describe("tags and notes are merged against the STORED row, not this phone's copy", () => {
  it("updateTags adds on top of a tag the other phone saved while this phone was behind, as a compare-and-swap, and reports only what it changed", async () => {
    // The database already has "Xmas" from the other phone; the caller's
    // store (from before the channel dropped) knows nothing about it
    const { state } = await setup([withCols({ ...camping, tags: ["Xmas"] })]);
    const { tote, applied } = await toteService.updateTags(1, { added: ["Lights"], removed: [] });
    expect(tote.tags).toEqual(["Xmas", "Lights"]);
    expect(applied).toEqual({ added: ["Lights"], removed: [] });
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].payload).sort()).toEqual(["tags", "updated_at"]);
    expect(state.updates[0].filters).toEqual([
      ["eq", "id", 1],
      ["not_match", "position", "^__"],
      ["eq", "updated_at", T0],
    ]);
    expect(new Date(tote.updated_at) > new Date(T0)).toBe(true);
  });

  it("updateTags: a tag they already have (any case) is neither duplicated nor claimed; a delta that changes nothing writes nothing", async () => {
    const { state } = await setup([withCols({ ...camping, tags: ["winter", "Fragile"] })]);
    const first = await toteService.updateTags(1, { added: ["fragile", "kids"], removed: [] });
    expect(first.tote.tags).toEqual(["winter", "Fragile", "kids"]);
    expect(first.applied).toEqual({ added: ["kids"], removed: [] });

    const again = await toteService.updateTags(1, { added: ["KIDS"], removed: ["nothing-here"] });
    expect(again.applied).toEqual({ added: [], removed: [] });
    expect(again.tote.tags).toEqual(["winter", "Fragile", "kids"]);
    expect(state.updates).toHaveLength(1);

    const empty = await toteService.updateTags(1, { added: [], removed: [] });
    expect(empty.applied).toEqual({ added: [], removed: [] });
    expect(empty.tote.id).toBe(1);
    expect(state.updates).toHaveLength(1);
  });

  it("updateTags re-applies the delta when the other phone wrote between our read and our write (lost compare-and-swap → re-read)", async () => {
    let raced = false;
    const { state } = await setup([withCols(camping)], {
      beforeUpdate: (st) => {
        if (raced) return;
        raced = true;
        const row = st.rows.find((r) => r.id === 1);
        row.tags = ["Xmas"];
        row.updated_at = new Date(Date.now() + 500).toISOString();
      },
    });
    const { tote, applied } = await toteService.updateTags(1, { added: ["Lights"], removed: [] });
    expect(tote.tags).toEqual(["Xmas", "Lights"]); // theirs kept, ours on top
    expect(applied).toEqual({ added: ["Lights"], removed: [] });
    expect(state.updates).toHaveLength(2); // the first write missed
    expect(state.rows[0].tags).toEqual(["Xmas", "Lights"]);
  });

  it("updateTags validates the MERGED list (their tags + ours) and sends nothing when it breaks a limit", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`);
    const { state } = await setup([withCols({ ...camping, tags: nine })]);
    await expect(
      toteService.updateTags(1, { added: ["a", "b"], removed: [] })
    ).rejects.toThrow(/up to 10 tags/i);
    expect(state.updates).toHaveLength(0);
    // Removing first makes room
    const { tote } = await toteService.updateTags(1, { added: ["a", "b"], removed: ["t0"] });
    expect(tote.tags).toHaveLength(10);
  });

  it("updateTags / updateNotes throw the setup error (and write nothing) while the columns are missing", async () => {
    const { state } = await setup([camping]);
    await expect(toteService.updateTags(1, { added: ["x"] })).rejects.toMatchObject({
      code: "SETUP_NEEDED",
    });
    await expect(toteService.updateNotes(1, "x")).rejects.toMatchObject({ code: "SETUP_NEEDED" });
    expect(state.updates).toHaveLength(0);
  });

  it("updateTags / updateNotes never touch a tombstone or an unknown id", async () => {
    const tomb = withCols({ ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) });
    const { state } = await setup([tomb, withCols(sports)]);
    await expect(toteService.updateTags(1, { added: ["x"] })).rejects.toThrow(/find that tote/i);
    await expect(toteService.updateNotes(1, "x")).rejects.toThrow(/find that tote/i);
    await expect(toteService.updateNotes(99, "x")).rejects.toThrow(/find that tote/i);
    expect(state.updates).toHaveLength(0);
  });

  it("updateNotes writes only while the STORED note is still the one the editor opened on; otherwise NOTES_CHANGED carries their text and nothing is written", async () => {
    // The other phone saved "lid cracked"; this phone's store still says
    // "Fragile", so its editor opened on "Fragile"
    const { state } = await setup([withCols({ ...camping, notes: "lid cracked" })]);
    await expect(
      toteService.updateNotes(1, "Fragile glass", { expected: "Fragile" })
    ).rejects.toMatchObject({
      code: "NOTES_CHANGED",
      details: { theirs: "lid cracked" },
    });
    expect(state.updates).toHaveLength(0);

    // The user saw theirs and chose to replace it
    const saved = await toteService.updateNotes(1, "Fragile glass", { expected: "lid cracked" });
    expect(saved.notes).toBe("Fragile glass");
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].payload).sort()).toEqual(["notes", "updated_at"]);
    expect(state.updates[0].filters).toContainEqual(["eq", "updated_at", T0]);
    expect(state.updates[0].filters).toContainEqual(["not_match", "position", "^__"]);
  });

  it("updateNotes: null means 'opened on no note'; a note the row already has writes nothing; without `expected` it replaces; blanks are stored as null", async () => {
    const { state } = await setup([withCols(camping)]); // notes: null
    await expect(
      toteService.updateNotes(1, "x", { expected: "something" })
    ).rejects.toMatchObject({ code: "NOTES_CHANGED", details: { theirs: null } });
    const first = await toteService.updateNotes(1, "  lid cracked \r\n", { expected: null });
    expect(first.notes).toBe("lid cracked");
    expect(state.updates).toHaveLength(1);

    const same = await toteService.updateNotes(1, "lid cracked", { expected: "whatever" });
    expect(same.notes).toBe("lid cracked"); // already says this: no conflict, no write
    expect(state.updates).toHaveLength(1);

    const replaced = await toteService.updateNotes(1, "   ");
    expect(replaced.notes).toBeNull();
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1].payload.notes).toBeNull();

    await expect(toteService.updateNotes(1, "x".repeat(501))).rejects.toThrow(/500 characters/i);
    expect(state.updates).toHaveLength(2);
  });
});

describe("removed-items bin: an item never gets two homes", () => {
  const entryFor = (toteId, toteName, position, item, age = daysAgo(1)) => ({
    id: `${toteId}:${item.id}:${age}`,
    item,
    toteId,
    toteName,
    position,
    removedAt: age,
  });
  const binRow = (entries, id = 50) => ({
    id,
    name: "bin",
    position: "__removed_items__",
    items: entries,
    created_at: T0,
    updated_at: T0,
  });

  it("forgetRemovedItems drops only the entries for those items from that tote — ids compared by type — and is scoped to the bin row", async () => {
    const keepStringSeven = entryFor(1, "Camping Gear", "B3", { id: "7", name: "Rope (string id)" });
    const keepOtherTote = entryFor(2, "Sports", "C4", lantern);
    const bin = binRow([
      entryFor(1, "Camping Gear", "B3", lantern),
      entryFor(1, "Camping Gear", "B3", rope), // numeric 7
      keepStringSeven,
      keepOtherTote,
    ]);
    const { state } = await setup([camping, sports, bin]);

    expect(await toteService.forgetRemovedItems(1, ["i1", 7])).toBe(1);
    const left = state.rows.find((r) => r.id === 50).items;
    expect(left.map((e) => e.id)).toEqual([keepStringSeven.id, keepOtherTote.id]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].filters).toContainEqual(["eq", "position", "__removed_items__"]);
    expect(state.updates[0].filters).not.toContainEqual(["not_match", "position", "^__"]);
    // Totes untouched
    expect(state.rows.find((r) => r.id === 1).items).toEqual([lantern, rope]);

    // Nothing left to forget → no write
    expect(await toteService.forgetRemovedItems(1, ["i1", 7])).toBe(0);
    expect(await toteService.forgetRemovedItems(1, [])).toBe(0);
    expect(state.updates).toHaveLength(1);
  });

  it("forgetRemovedItems with no bin row at all is a quiet no-op", async () => {
    const { state } = await setup([camping]);
    expect(await toteService.forgetRemovedItems(1, ["i1"])).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("remove → Undo → move → Put back: the item already lives in another tote, so nothing is added (ALREADY_THERE says where) and the stale entry is dropped", async () => {
    // Lantern was removed from Camping (entry recorded), Undo put it back
    // (the entry survived, say the forget failed offline), then it was
    // MOVED to Sports. Now someone taps "Put back" on the stale entry.
    const entry = entryFor(1, "Camping Gear", "B3", lantern);
    const { state } = await setup([
      { ...camping, items: [rope] },
      { ...sports, items: [lantern] },
      binRow([entry]),
    ]);
    await expect(toteService.restoreRemovedItem(entry.id)).rejects.toMatchObject({
      code: "ALREADY_THERE",
      message: "“Lantern” is already in “Sports”.",
      details: { toteId: 2, toteName: "Sports" },
    });
    // One home only; the only write was the bin clean-up
    expect(state.rows.find((r) => r.id === 1).items).toEqual([rope]);
    expect(state.rows.find((r) => r.id === 2).items).toEqual([lantern]);
    expect(state.rows.find((r) => r.id === 50).items).toEqual([]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].filters).toContainEqual(["eq", "position", "__removed_items__"]);
    expect(await toteService.listRemovedItems()).toEqual([]);
  });

  it("ids are compared by type: a tote holding item \"7\" does not block putting back item 7", async () => {
    const entry = entryFor(1, "Camping Gear", "B3", rope); // numeric 7
    const { state } = await setup([
      { ...camping, items: [lantern] },
      { ...sports, items: [{ id: "7", name: "Other rope" }] },
      binRow([entry]),
    ]);
    const saved = await toteService.restoreRemovedItem(entry.id);
    expect(saved.id).toBe(1);
    expect(saved.items).toEqual([lantern, rope]);
    expect(state.rows.find((r) => r.id === 2).items).toEqual([{ id: "7", name: "Other rope" }]);
  });

  it("the TOTE_GONE retry: the original tote is gone and the item was already put into a picked tote (an earlier put-back whose entry drop failed) → ALREADY_THERE, no duplicate", async () => {
    const entry = entryFor(1, "Camping Gear", "B3", lantern);
    const tomb = { ...camping, items: [rope], position: "__deleted__:B3:1", updated_at: daysAgo(1) };
    const { state } = await setup([tomb, { ...sports, items: [lantern] }, binRow([entry])]);
    await expect(toteService.restoreRemovedItem(entry.id, 2)).rejects.toMatchObject({
      code: "ALREADY_THERE",
      details: { toteId: 2 },
    });
    expect(state.rows.find((r) => r.id === 2).items).toEqual([lantern]); // still exactly one
    expect(state.rows.find((r) => r.id === 50).items).toEqual([]);
    // An item in a TOMBSTONE doesn't count as having a home
    const entry2 = entryFor(1, "Camping Gear", "B3", rope);
    state.rows.find((r) => r.id === 50).items = [entry2];
    await expect(toteService.restoreRemovedItem(entry2.id)).rejects.toMatchObject({ code: "TOTE_GONE" });
    const saved = await toteService.restoreRemovedItem(entry2.id, 2);
    expect(saved.items).toEqual([lantern, rope]);
  });
});

describe("soft delete", () => {
  it("moves the row to a per-tote tombstone position and frees the slot", async () => {
    const { state } = await setup([camping], { uniquePosition: true });
    const entry = await toteService.deleteTote(1);

    const row = state.rows.find((r) => r.id === 1);
    expect(row.position).toBe("__deleted__:B3:1");
    expect(row.items).toEqual([lantern, rope]); // items kept
    expect(Object.keys(state.updates[0].payload).sort()).toEqual(["position", "updated_at"]);
    expect(state.updates[0].filters).toContainEqual(["eq", "position", "B3"]);
    expect(state.deletes).toHaveLength(0);

    expect(entry).toMatchObject({
      id: 1,
      name: "Camping Gear",
      originalPosition: "B3",
      items: [lantern, rope],
      created_at: T0,
    });
    expect(entry.deletedAt).toBe(row.updated_at);

    // Hidden from the walls, listed under deleted, slot reusable at once
    const { data, deleted } = await toteService.getTotes();
    expect(data).toHaveLength(0);
    expect(deleted.map((d) => d.id)).toEqual([1]);
    const fresh = await toteService.saveTote({ name: "New", position: "B3", items: [] }, true);
    expect(fresh.position).toBe("B3");
  });

  it("is a no-op for unknown or already-deleted totes", async () => {
    const tomb = { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) };
    const { state } = await setup([tomb]);
    expect(await toteService.deleteTote(42)).toBeNull();
    const again = await toteService.deleteTote(1);
    expect(again.originalPosition).toBe("B3");
    expect(state.updates).toHaveLength(0);
  });

  it("re-reads when the other phone moved the tote first, so the original spot is right", async () => {
    let raced = false;
    const { state } = await setup([camping], {
      beforeUpdate: (st) => {
        if (raced) return;
        raced = true;
        const row = st.rows.find((r) => r.id === 1);
        row.position = "A1";
        row.updated_at = new Date(Date.now() + 500).toISOString();
      },
    });
    const entry = await toteService.deleteTote(1);
    expect(entry.originalPosition).toBe("A1");
    expect(state.rows[0].position).toBe("__deleted__:A1:1");
    expect(state.updates).toHaveLength(2);
  });
});

describe("updateTote never revives a soft-deleted tote", () => {
  const tomb = { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) };

  it("a rename/move from a stale page reports 'couldn't find' and leaves the tombstone", async () => {
    // Phone A deleted tote 1 and put a new tote at B3; phone B still has the
    // form open and saves { name, position: "B3" }.
    const squatter = { ...sports, id: 3, position: "B3" };
    const { state } = await setup([tomb, squatter]);
    await expect(
      toteService.updateTote(1, { name: "Camp", position: "B3" })
    ).rejects.toThrow(/find that tote/i);
    const row = state.rows.find((r) => r.id === 1);
    expect(row.position).toBe("__deleted__:B3:1");
    expect(row.name).toBe("Camping Gear");
    expect(state.rows.filter((r) => r.position === "B3")).toHaveLength(1);
    // The write itself carries the reserved-row exclusion (no read-then-write race)
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].filters).toEqual([
      ["eq", "id", 1],
      ["not_match", "position", "^__"],
    ]);
  });

  it("an unknown id is also 'couldn't find'; a live tote still saves", async () => {
    const { state } = await setup([withCols(camping)]);
    await expect(toteService.updateTote(99, { name: "x" })).rejects.toThrow(/find that tote/i);
    const saved = await toteService.updateTote(1, { name: "Camp" });
    expect(saved.name).toBe("Camp");
    expect(state.rows[0].name).toBe("Camp");
  });

  it("the settings and bin rows can't be patched as totes either", async () => {
    const config = { id: 10, name: "cfg", position: "__config__", items: { leftShelves: 3 }, updated_at: T0 };
    const { state } = await setup([camping, config]);
    await expect(toteService.updateTote(10, { position: "A1" })).rejects.toThrow(/find that tote/i);
    expect(state.rows.find((r) => r.id === 10).position).toBe("__config__");
  });
});

describe("updateItems never writes a reserved row", () => {
  const tomb = { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) };
  const glue = { id: "i3", name: "Glue", qty: 1 };

  it("a +/- tap, item add or item move into a soft-deleted tote reports 'couldn't find' and leaves the tombstone unchanged", async () => {
    // Phone B deleted tote 1; phone A still has it open (or picked it as a
    // move target) and its realtime link is down, so it never heard.
    const { state } = await setup([tomb, sports]);
    await expect(toteService.updateItems(1, adjustQty("i1", 1))).rejects.toThrow(/find that tote/i);
    await expect(toteService.updateItems(1, addItem(glue))).rejects.toThrow(/find that tote/i);
    expect(state.updates).toHaveLength(0); // refused on the read: nothing sent
    expect(state.rows.find((r) => r.id === 1)).toEqual(tomb);

    // A live tote still saves, and the write itself excludes reserved rows
    const saved = await toteService.updateItems(2, addItem(glue));
    expect(saved.items).toEqual([glue]);
    expect(state.updates[0].filters).toEqual([
      ["eq", "id", 2],
      ["not_match", "position", "^__"],
      ["eq", "updated_at", T0],
    ]);
  });

  it("the other phone deletes between our read and our write: the write misses and the re-read refuses", async () => {
    let raced = false;
    const { state } = await setup([camping], {
      beforeUpdate: (st) => {
        if (raced) return;
        raced = true;
        const row = st.rows.find((r) => r.id === 1);
        row.position = "__deleted__:B3:1";
        row.updated_at = new Date(Date.now() + 500).toISOString();
      },
    });
    await expect(toteService.updateItems(1, adjustQty("i1", 1))).rejects.toThrow(/find that tote/i);
    expect(state.updates).toHaveLength(1);
    const row = state.rows.find((r) => r.id === 1);
    expect(row.position).toBe("__deleted__:B3:1");
    expect(row.items).toEqual([lantern, rope]); // our tap never landed
  });

  it("the settings and bin rows can't be edited as totes; the bin's own writes are scoped to the bin row", async () => {
    const config = { id: 10, name: "cfg", position: "__config__", items: { leftShelves: 3 }, updated_at: T0 };
    const bin = { id: 50, name: "bin", position: "__removed_items__", items: [], created_at: T0, updated_at: T0 };
    const { state } = await setup([camping, config, bin]);
    await expect(toteService.updateItems(10, () => [])).rejects.toThrow(/find that tote/i);
    await expect(toteService.updateItems(50, () => [])).rejects.toThrow(/find that tote/i);
    expect(state.updates).toHaveLength(0);

    await toteService.recordRemovedItems(camping, [lantern]);
    expect(state.rows.find((r) => r.id === 50).items).toHaveLength(1);
    const binWrite = state.updates.at(-1);
    expect(binWrite.filters).toContainEqual(["eq", "id", 50]);
    expect(binWrite.filters).toContainEqual(["eq", "position", "__removed_items__"]);
    expect(binWrite.filters).not.toContainEqual(["not_match", "position", "^__"]);
  });
});

describe("restoreDeletedTote / purgeDeletedTote", () => {
  const tomb = { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) };

  it("restores to the original spot keeping id and created_at", async () => {
    const { state } = await setup([tomb], { uniquePosition: true });
    const row = await toteService.restoreDeletedTote(1);
    expect(row).toMatchObject({ id: 1, position: "B3", created_at: T0, items: [lantern, rope] });
    expect(state.rows[0].position).toBe("B3");
    expect(state.updates[0].filters).toContainEqual(["eq", "position", "__deleted__:B3:1"]);
  });

  it("refuses when the original spot is taken (SLOT_TAKEN), unless a free target is given", async () => {
    const squatter = { ...sports, id: 3, position: "B3" };
    const { state } = await setup([tomb, squatter], { uniquePosition: true });
    await expect(toteService.restoreDeletedTote(1)).rejects.toMatchObject({
      code: "SLOT_TAKEN",
    });
    expect(state.updates).toHaveLength(0);

    const row = await toteService.restoreDeletedTote(1, "C4");
    expect(row.position).toBe("C4");
    await expect(toteService.restoreDeletedTote(1, "C4")).resolves.toMatchObject({ id: 1 }); // already live
  });

  it("a taken target spot is also SLOT_TAKEN; reserved targets are refused", async () => {
    const { state } = await setup([tomb, sports]);
    await expect(toteService.restoreDeletedTote(1, "C4")).rejects.toMatchObject({
      code: "SLOT_TAKEN",
    });
    await expect(toteService.restoreDeletedTote(1, "__config__")).rejects.toThrow(/empty spot/i);
    expect(state.updates).toHaveLength(0);
  });

  it("NO_TOMBSTONE when there is nothing to restore", async () => {
    await setup([camping]);
    await expect(toteService.restoreDeletedTote(99)).rejects.toMatchObject({
      code: "NO_TOMBSTONE",
    });
  });

  it("purge hard-deletes only a tombstone, matched on its exact position", async () => {
    const { state } = await setup([tomb, sports]);
    await toteService.purgeDeletedTote(2); // live tote → untouched
    expect(state.deletes).toHaveLength(0);
    await toteService.purgeDeletedTote(1);
    expect(state.deletes[0]).toEqual([
      ["eq", "id", 1],
      ["eq", "position", "__deleted__:B3:1"],
    ]);
    expect(state.rows.map((r) => r.id)).toEqual([2]);
  });

  it("getTotes auto-purges tombstones older than 30 days (best effort) and hides them", async () => {
    const old = { ...camping, id: 5, position: "__deleted__:A1:5", updated_at: daysAgo(31) };
    const { state, loaded } = await setup([tomb, old, sports]);
    expect(loaded.deleted.map((d) => d.id)).toEqual([1]);
    expect(loaded.data.map((t) => t.id)).toEqual([2]);
    await flush();
    expect(state.rows.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(state.deletes).toHaveLength(1);
  });
});

describe("removed-items bin", () => {
  it("creates the bin row on first use with the entry shape, then appends via compare-and-swap", async () => {
    const { state } = await setup([camping], { uniquePosition: true });
    const row = await toteService.recordRemovedItems(camping, [lantern]);
    expect(state.inserts).toHaveLength(1);
    expect(row.position).toBe("__removed_items__");
    expect(row.items).toHaveLength(1);
    const [entry] = row.items;
    expect(entry).toMatchObject({ item: lantern, toteId: 1, toteName: "Camping Gear", position: "B3" });
    expect(entry.id).toBe(`1:i1:${entry.removedAt}`);
    expect(new Date(entry.removedAt).toString()).not.toBe("Invalid Date");

    await toteService.recordRemovedItems(camping, [rope]);
    expect(state.inserts).toHaveLength(1);
    const upd = state.updates.at(-1);
    expect(Object.keys(upd.payload).sort()).toEqual(["items", "updated_at"]);
    expect(upd.filters).toContainEqual(["eq", "updated_at", row.updated_at]);
    expect(upd.payload.items.map((e) => e.item.id)).toEqual(expect.arrayContaining(["i1", 7]));
    expect(upd.payload.items).toHaveLength(2);

    const list = await toteService.listRemovedItems();
    expect(list).toHaveLength(2);
  });

  it("an item with an embedded photo is binned without the data-URI (cache/quota safety)", async () => {
    const dataUri = `data:image/jpeg;base64,${"a".repeat(256)}`;
    const vase = { id: "v", name: "Vase", image: dataUri };
    const { state } = await setup([camping], { uniquePosition: true });
    const row = await toteService.recordRemovedItems(camping, [vase]);
    expect(row.items[0].item).toEqual({ id: "v", name: "Vase", image: null });
    expect(JSON.stringify(state.inserts)).not.toContain("data:");

    // Appends go through the same path
    await toteService.recordRemovedItems(camping, [{ ...vase, id: "v2" }]);
    expect(JSON.stringify(state.updates)).not.toContain("data:");
    // and the offline cache never holds one either
    await toteService.getTotes();
    expect(localStorage.getItem("totes-cache")).not.toContain("data:");
  });

  it("two phones racing to create the bin: the loser re-reads and appends to the winner's row", async () => {
    const theirs = {
      id: "9:z:2026-01-01T00:00:00.000Z",
      item: { id: "z", name: "Glue" },
      toteId: 9,
      toteName: "Paint",
      position: "A1",
      removedAt: daysAgo(1),
    };
    const { state } = await setup([camping], {
      uniquePosition: true,
      beforeInsert: (st, q) => {
        if (q.payload.position !== "__removed_items__") return;
        if (st.rows.some((r) => r.position === "__removed_items__")) return;
        st.rows.push({
          id: 77,
          name: "bin",
          position: "__removed_items__",
          items: [theirs],
          created_at: T0,
          updated_at: T0,
        });
      },
    });
    await toteService.recordRemovedItems(camping, [lantern]);
    const bins = state.rows.filter((r) => r.position === "__removed_items__");
    expect(bins).toHaveLength(1);
    expect(bins[0].id).toBe(77);
    expect(bins[0].items.map((e) => e.item.id).sort()).toEqual(["i1", "z"]);
  });

  it("prunes entries older than 30 days and beyond 200 (newest kept)", async () => {
    const mk = (i, age) => ({
      id: `1:x${i}:${age}`,
      item: { id: `x${i}`, name: `Thing ${i}` },
      toteId: 1,
      toteName: "Camping Gear",
      position: "B3",
      removedAt: age,
    });
    const stale = mk("old", daysAgo(31));
    const many = Array.from({ length: 200 }, (_, i) => mk(i, daysAgo(2 + i / 1000)));
    const bin = {
      id: 50,
      name: "bin",
      position: "__removed_items__",
      items: [stale, ...many],
      created_at: T0,
      updated_at: T0,
    };
    const { state } = await setup([camping, bin]);
    await toteService.recordRemovedItems(camping, [lantern]);
    const items = state.rows.find((r) => r.id === 50).items;
    expect(items).toHaveLength(200);
    expect(items[0].item.id).toBe("i1"); // newest first
    expect(items.some((e) => e.id === stale.id)).toBe(false);
    expect(items.some((e) => e.item.id === "x199")).toBe(false); // oldest of the 200 dropped

    const listed = await toteService.listRemovedItems();
    expect(listed[0].item.id).toBe("i1");
  });

  it("restoreRemovedItem puts the item back into its tote and drops the entry", async () => {
    const entry = {
      id: `1:i1:${daysAgo(1)}`,
      item: lantern,
      toteId: 1,
      toteName: "Camping Gear",
      position: "B3",
      removedAt: daysAgo(1),
    };
    const bin = {
      id: 50,
      name: "bin",
      position: "__removed_items__",
      items: [entry],
      created_at: T0,
      updated_at: T0,
    };
    const { state } = await setup([{ ...camping, items: [rope] }, bin]);
    const saved = await toteService.restoreRemovedItem(entry.id);
    expect(saved.id).toBe(1);
    expect(saved.items).toEqual([rope, lantern]);
    expect(state.rows.find((r) => r.id === 50).items).toEqual([]);
    await expect(toteService.restoreRemovedItem(entry.id)).rejects.toThrow(/no longer in the bin/i);
  });

  it("original tote gone → TOTE_GONE unless a target tote is given", async () => {
    const entry = {
      id: `1:i1:${daysAgo(1)}`,
      item: lantern,
      toteId: 1,
      toteName: "Camping Gear",
      position: "B3",
      removedAt: daysAgo(1),
    };
    const bin = { id: 50, name: "bin", position: "__removed_items__", items: [entry], created_at: T0, updated_at: T0 };
    const tomb = { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(1) };
    const { state } = await setup([tomb, sports, bin]);
    await expect(toteService.restoreRemovedItem(entry.id)).rejects.toMatchObject({ code: "TOTE_GONE" });
    expect(state.updates).toHaveLength(0);

    const saved = await toteService.restoreRemovedItem(entry.id, 2);
    expect(saved.id).toBe(2);
    expect(saved.items).toEqual([lantern]);
    expect(state.rows.find((r) => r.id === 1).items).toEqual([lantern, rope]); // tombstone untouched
  });
});

describe("splitConfig", () => {
  it("never leaks any '__' row into totes", () => {
    const rows = [
      camping,
      { id: 10, position: "__config__", items: { leftShelves: 3 }, updated_at: T0 },
      { id: 11, position: "__removed_items__", items: [] },
      { id: 12, name: "Old", position: "__deleted__:A1:12", items: [], updated_at: T0, created_at: T0 },
      { id: 13, position: "__future__", items: [] },
      { id: 14, position: "__deleted__:broken", items: [] },
    ];
    const out = splitConfig(rows);
    expect(out.totes.map((t) => t.id)).toEqual([1]);
    expect(out.layout).toEqual({ leftShelves: 3 });
    expect(out.deleted).toEqual([
      { id: 12, name: "Old", originalPosition: "A1", deletedAt: T0, items: [], created_at: T0 },
    ]);
    expect(out.removedRows.map((r) => r.id)).toEqual([11]);
  });
});
