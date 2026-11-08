import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
