import { beforeEach, describe, expect, it } from "vitest";
import { toteService } from "../toteService";

// Local (localStorage) mode — the Supabase module is aliased to null in tests.
const STORE = "totes-inventory";

const seed = (totes) => localStorage.setItem(STORE, JSON.stringify(totes));
const read = () => JSON.parse(localStorage.getItem(STORE));

describe("toteService.updateTote (field-level patches)", () => {
  beforeEach(() => {
    seed([
      {
        id: 1,
        name: "Camping Gear",
        position: "B3",
        items: [{ id: "i1", name: "Lantern", qty: 2 }],
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ]);
  });

  it("patches only the given fields", async () => {
    await toteService.updateTote(1, { position: "D5" });
    const t = read()[0];
    expect(t.position).toBe("D5");
    expect(t.name).toBe("Camping Gear");
    expect(t.items).toEqual([{ id: "i1", name: "Lantern", qty: 2 }]);
  });

  it("a move and an item edit never clobber each other (regression: review #1/#2)", async () => {
    // Fired concurrently, as when a debounced item save races a move
    await Promise.all([
      toteService.updateTote(1, { items: [{ id: "i1", name: "Lantern", qty: 3 }] }),
      toteService.updateTote(1, { position: "A2" }),
    ]);
    const t = read()[0];
    expect(t.position).toBe("A2");
    expect(t.items[0].qty).toBe(3);
  });

  it("throws a friendly error for an unknown id", async () => {
    await expect(toteService.updateTote(999, { position: "A1" })).rejects.toThrow(
      /find that tote/i
    );
  });

  it("saveTote(update) routes through the patch path", async () => {
    const saved = await toteService.saveTote(
      { id: 1, name: "  Camping Gear  ", position: "B3", items: [] },
      false
    );
    expect(saved.name).toBe("Camping Gear");
    expect(read()[0].items).toEqual([]);
  });
});
