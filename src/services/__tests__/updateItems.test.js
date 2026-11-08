import { beforeEach, describe, expect, it } from "vitest";
import { toteService } from "../toteService";
import { addItem, adjustQty, removeItem, restoreItem } from "../../utils/itemOps";

// Local (localStorage) mode — the Supabase module is aliased to null in tests.
const STORE = "totes-inventory";

const seed = (totes) => localStorage.setItem(STORE, JSON.stringify(totes));
const read = () => JSON.parse(localStorage.getItem(STORE));
const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };

describe("toteService.updateItems (local mode, operations not snapshots)", () => {
  beforeEach(() => {
    seed([
      {
        id: 1,
        name: "Camping Gear",
        position: "B3",
        items: [lantern],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("applies the op to the stored copy and bumps updated_at", async () => {
    const saved = await toteService.updateItems(1, adjustQty("i1", 1));
    expect(saved.items[0].qty).toBe(3);
    expect(saved.name).toBe("Camping Gear");
    expect(saved.position).toBe("B3");
    expect(new Date(saved.updated_at) > new Date("2026-01-01T00:00:00.000Z")).toBe(true);
    expect(read()[0].items[0].qty).toBe(3);
  });

  it("two devices interleaving: A adds an item while B changes a qty → both survive", async () => {
    // Phone A adds Rope; phone B (holding a stale copy without Rope) bumps Lantern
    await toteService.updateItems(1, addItem(rope));
    await toteService.updateItems(1, adjustQty("i1", 1));

    const t = read()[0];
    expect(t.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(t.items[0].qty).toBe(3);
  });

  it("ops fired concurrently are serialized through the per-tote queue", async () => {
    await Promise.all([
      toteService.updateItems(1, addItem(rope)),
      toteService.updateItems(1, adjustQty("i1", -1)),
      toteService.updateItems(1, adjustQty("i2", 4)),
    ]);
    const t = read()[0];
    expect(t.items).toEqual([{ ...lantern, qty: 1 }, { ...rope, qty: 5 }]);
  });

  it("remove then undo (restore-at-index) round-trips without duplicates", async () => {
    await toteService.updateItems(1, addItem(rope));
    await toteService.updateItems(1, removeItem("i1"));
    expect(read()[0].items.map((i) => i.id)).toEqual(["i2"]);
    await toteService.updateItems(1, restoreItem(lantern, 0));
    await toteService.updateItems(1, restoreItem(lantern, 0)); // retry is harmless
    expect(read()[0].items.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("an item edit and a move never clobber each other", async () => {
    await Promise.all([
      toteService.updateItems(1, adjustQty("i1", 1)),
      toteService.updateTote(1, { position: "A2" }),
    ]);
    const t = read()[0];
    expect(t.position).toBe("A2");
    expect(t.items[0].qty).toBe(3);
  });

  it("treats a missing/corrupt items column as an empty list", async () => {
    seed([{ id: 1, name: "Empty", position: "B3", items: null }]);
    const saved = await toteService.updateItems(1, addItem(rope));
    expect(saved.items).toEqual([rope]);
  });

  it("throws a friendly error for an unknown id", async () => {
    await expect(toteService.updateItems(999, addItem(rope))).rejects.toThrow(
      /find that tote/i
    );
  });

  it("rejects a non-function operation (programming error, not a user error)", async () => {
    await expect(toteService.updateItems(1, [rope])).rejects.toThrow(TypeError);
  });
});
