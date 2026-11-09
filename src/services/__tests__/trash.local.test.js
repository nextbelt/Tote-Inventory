import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, adjustQty, removeItem, restoreItem } from "../../utils/itemOps";

// Local (localStorage) mode — the Supabase module is aliased to null in tests.
const STORE = "totes-inventory";
const seed = (totes) => localStorage.setItem(STORE, JSON.stringify(totes));
const read = () => JSON.parse(localStorage.getItem(STORE) || "[]");
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const T0 = "2026-01-01T00:00:00.000Z";
const lantern = { id: "i1", name: "Lantern", qty: 2 };
const camping = { id: 1, name: "Camping Gear", position: "B3", items: [lantern], created_at: T0, updated_at: T0 };
const sports = { id: 2, name: "Sports", position: "C4", items: [], created_at: T0, updated_at: T0 };

let toteService;

beforeEach(async () => {
  vi.resetModules();
  ({ toteService } = await import("../toteService"));
  seed([camping, sports]);
});

describe("local mode: capabilities and swap", () => {
  it("capabilities are always on", async () => {
    const { capabilities, source } = await toteService.getTotes();
    expect(source).toBe("local");
    expect(capabilities).toEqual({ tags: true, notes: true, swap: true });
  });

  it("updateTote stores normalized tags and notes", async () => {
    const saved = await toteService.updateTote(1, { tags: ["a", "A", " b  c "], notes: " n " });
    expect(saved.tags).toEqual(["a", "b c"]);
    expect(saved.notes).toBe("n");
  });

  it("swapTotes swaps positions, stamps both and returns [a, b]", async () => {
    const [a, b] = await toteService.swapTotes(1, 2);
    expect(a).toMatchObject({ id: 1, position: "C4" });
    expect(b).toMatchObject({ id: 2, position: "B3" });
    expect(a.updated_at).toBe(b.updated_at);
    expect(new Date(a.updated_at) > new Date(T0)).toBe(true);
    expect(read().map((t) => t.position)).toEqual(["C4", "B3"]);
  });

  it("swapTotes refuses missing or reserved rows", async () => {
    await expect(toteService.swapTotes(1, 9)).rejects.toThrow(/no longer exists/i);
    await toteService.deleteTote(2);
    await expect(toteService.swapTotes(1, 2)).rejects.toThrow(/can't be swapped/i);
  });

  it("swapTotes with the spots the user saw: refuses (TOTE_MOVED) when a tote is elsewhere now, swaps when both match", async () => {
    await toteService.updateTote(2, { position: "A1" }); // moved meanwhile
    await expect(
      toteService.swapTotes(1, 2, { expectA: "B3", expectB: "C4" })
    ).rejects.toMatchObject({ code: "TOTE_MOVED", message: /“Sports” was moved/ });
    expect(read().map((t) => t.position)).toEqual(["B3", "A1"]);
    const [a, b] = await toteService.swapTotes(1, 2, { expectA: "B3", expectB: "A1" });
    expect(a.position).toBe("A1");
    expect(b.position).toBe("B3");
  });

  it("updateTags merges a delta into the stored tags; updateNotes refuses a changed note", async () => {
    await toteService.updateTote(1, { tags: ["Xmas"], notes: "lid cracked" });
    const { tote, applied } = await toteService.updateTags(1, { added: ["Lights", "xmas"], removed: [] });
    expect(tote.tags).toEqual(["Xmas", "Lights"]);
    expect(applied).toEqual({ added: ["Lights"], removed: [] });
    await expect(
      toteService.updateNotes(1, "Fragile", { expected: null })
    ).rejects.toMatchObject({ code: "NOTES_CHANGED", details: { theirs: "lid cracked" } });
    const saved = await toteService.updateNotes(1, "Fragile", { expected: "lid cracked" });
    expect(saved.notes).toBe("Fragile");
  });
});

describe("local mode: soft delete, restore, purge", () => {
  it("deleteTote leaves a tombstone, hides it from totes and lists it under deleted", async () => {
    const entry = await toteService.deleteTote(1);
    expect(entry).toMatchObject({ id: 1, name: "Camping Gear", originalPosition: "B3", items: [lantern] });
    const stored = read();
    expect(stored).toHaveLength(2);
    expect(stored.find((t) => t.id === 1).position).toBe("__deleted__:B3:1");

    const { data, deleted } = await toteService.getTotes();
    expect(data.map((t) => t.id)).toEqual([2]);
    expect(deleted.map((d) => d.id)).toEqual([1]);

    // slot B3 is free again
    const fresh = await toteService.saveTote({ name: "New", position: "B3", items: [] }, true);
    expect(fresh.position).toBe("B3");
  });

  it("restoreDeletedTote: original spot, taken spot, target spot", async () => {
    await toteService.deleteTote(1);
    const back = await toteService.restoreDeletedTote(1);
    expect(back).toMatchObject({ id: 1, position: "B3", created_at: T0 });

    await toteService.deleteTote(1);
    await toteService.saveTote({ name: "Squatter", position: "B3", items: [] }, true);
    await expect(toteService.restoreDeletedTote(1)).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    await expect(toteService.restoreDeletedTote(1, "C4")).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    const moved = await toteService.restoreDeletedTote(1, "A1");
    expect(moved.position).toBe("A1");
    await expect(toteService.restoreDeletedTote(42)).rejects.toMatchObject({ code: "NO_TOMBSTONE" });
  });

  it("updateTote can't revive a tombstone (stale rename/move → 'couldn't find')", async () => {
    await toteService.deleteTote(1);
    await toteService.saveTote({ name: "Squatter", position: "B3", items: [] }, true);
    await expect(toteService.updateTote(1, { name: "Camp", position: "B3" })).rejects.toThrow(
      /find that tote/i
    );
    const stored = read();
    expect(stored.find((t) => t.id === 1).position).toBe("__deleted__:B3:1");
    expect(stored.filter((t) => t.position === "B3")).toHaveLength(1);
    const { deleted } = await toteService.getTotes();
    expect(deleted.map((d) => d.id)).toEqual([1]); // still restorable
  });

  it("purgeDeletedTote removes a tombstone but never a live tote", async () => {
    await toteService.deleteTote(1);
    await toteService.purgeDeletedTote(2);
    expect(read()).toHaveLength(2);
    await toteService.purgeDeletedTote(1);
    expect(read().map((t) => t.id)).toEqual([2]);
  });

  it("getTotes purges tombstones older than 30 days", async () => {
    seed([
      { ...camping, position: "__deleted__:B3:1", updated_at: daysAgo(31) },
      { ...sports, id: 3, position: "__deleted__:C4:3", updated_at: daysAgo(29) },
    ]);
    const { data, deleted } = await toteService.getTotes();
    expect(data).toEqual([]);
    expect(deleted.map((d) => d.id)).toEqual([3]);
    expect(read().map((t) => t.id)).toEqual([3]);
  });
});

describe("local mode: removed-items bin", () => {
  it("records, lists and restores removed items", async () => {
    await toteService.updateItems(1, () => []);
    await toteService.recordRemovedItems(camping, [lantern]);
    const bin = read().find((t) => t.position === "__removed_items__");
    expect(bin.items).toHaveLength(1);
    expect(bin.items[0]).toMatchObject({ item: lantern, toteId: 1, toteName: "Camping Gear", position: "B3" });

    const { data } = await toteService.getTotes();
    expect(data.map((t) => t.id).sort()).toEqual([1, 2]); // bin row hidden

    const [entry] = await toteService.listRemovedItems();
    const saved = await toteService.restoreRemovedItem(entry.id);
    expect(saved.items).toEqual([lantern]);
    expect(await toteService.listRemovedItems()).toEqual([]);
  });

  it("restoring into a gone tote needs a target", async () => {
    await toteService.recordRemovedItems(camping, [lantern]);
    await toteService.deleteTote(1);
    const [entry] = await toteService.listRemovedItems();
    await expect(toteService.restoreRemovedItem(entry.id)).rejects.toMatchObject({ code: "TOTE_GONE" });
    const saved = await toteService.restoreRemovedItem(entry.id, 2);
    expect(saved.id).toBe(2);
    expect(saved.items).toEqual([lantern]);
  });

  it("remove → Undo (forget) → move → bin: nothing to put back and never a second home", async () => {
    // Remove, recorded in the bin
    await toteService.updateItems(1, removeItem("i1"));
    await toteService.recordRemovedItems(camping, [lantern]);
    expect(await toteService.listRemovedItems()).toHaveLength(1);
    // Undo puts it back and drops the entry
    await toteService.updateItems(1, restoreItem(lantern, 0));
    expect(await toteService.forgetRemovedItems(1, ["i1"])).toBe(1);
    expect(await toteService.listRemovedItems()).toEqual([]);
    // Later moved to Sports
    await toteService.updateItems(2, addItem(lantern));
    await toteService.updateItems(1, removeItem("i1"));
    expect(await toteService.listRemovedItems()).toEqual([]); // still nothing stale

    // And had the forget failed (entry left behind), Put back refuses rather
    // than give Lantern a second home — and cleans the entry up
    await toteService.recordRemovedItems(camping, [lantern]); // the stale entry
    const [stale] = await toteService.listRemovedItems();
    await expect(toteService.restoreRemovedItem(stale.id)).rejects.toMatchObject({
      code: "ALREADY_THERE",
      details: { toteId: 2, toteName: "Sports" },
    });
    expect(read().find((t) => t.id === 1).items).toEqual([]);
    expect(read().find((t) => t.id === 2).items).toEqual([lantern]);
    expect(await toteService.listRemovedItems()).toEqual([]);
  });
});

describe("local mode: updateItems never writes a reserved row", () => {
  const glue = { id: "i3", name: "Glue", qty: 1 };

  it("a +/- tap or item add on a soft-deleted tote reports 'couldn't find' and leaves the tombstone unchanged", async () => {
    // The other phone deleted tote 1 while this one still had it open
    await toteService.deleteTote(1);
    const before = read().find((t) => t.id === 1);
    await expect(toteService.updateItems(1, adjustQty("i1", 1))).rejects.toThrow(/find that tote/i);
    await expect(toteService.updateItems(1, addItem(glue))).rejects.toThrow(/find that tote/i);
    expect(read().find((t) => t.id === 1)).toEqual(before);

    // Still hidden, still restorable with its items intact
    const { data, deleted } = await toteService.getTotes();
    expect(data.map((t) => t.id)).toEqual([2]);
    expect(deleted.map((d) => d.id)).toEqual([1]);
    expect(deleted[0].items).toEqual([lantern]);
  });

  it("the settings and bin rows can't be edited as totes, while the bin's own writes still work", async () => {
    seed([camping, { id: 10, name: "cfg", position: "__config__", items: { leftShelves: 3 }, updated_at: T0 }]);
    await expect(toteService.updateItems(10, () => [])).rejects.toThrow(/find that tote/i);
    expect(read().find((t) => t.id === 10).items).toEqual({ leftShelves: 3 });

    await toteService.recordRemovedItems(camping, [lantern]);
    const binId = read().find((t) => t.position === "__removed_items__").id;
    await expect(toteService.updateItems(binId, () => [])).rejects.toThrow(/find that tote/i);
    expect(read().find((t) => t.id === binId).items).toHaveLength(1);

    // The bin's internal append / drop path is unaffected by the guard.
    // (Lantern was never actually removed from Camping here, so Put back
    // refuses — and drops the stale entry through that same bin path.)
    await toteService.recordRemovedItems(camping, [glue]);
    expect(read().find((t) => t.id === binId).items).toHaveLength(2);
    const stale = (await toteService.listRemovedItems()).find((e) => e.item.id === "i1");
    await expect(toteService.restoreRemovedItem(stale.id)).rejects.toMatchObject({
      code: "ALREADY_THERE",
    });
    expect(read().find((t) => t.id === binId).items).toHaveLength(1);
    expect(read().find((t) => t.id === 1).items).toEqual([lantern]); // still just one
    const [entry] = await toteService.listRemovedItems();
    expect(entry.item.id).toBe("i3");
    await toteService.restoreRemovedItem(entry.id);
    expect(read().find((t) => t.id === binId).items).toHaveLength(0);
    expect(read().find((t) => t.id === 1).items).toEqual([lantern, glue]);
  });
});
