import { beforeEach, describe, expect, it } from "vitest";
import { toteService } from "../toteService";

const STORE_KEY = "totes-inventory";

function readStore() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
}

describe("toteService (local mode)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getTotes returns { data, source: 'local' } from localStorage", async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([{ id: 1, name: "Camping Gear", position: "B3", items: [] }])
    );
    const result = await toteService.getTotes();
    expect(result.source).toBe("local");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Camping Gear");
  });

  it("saveTote(tote, true) creates a tote with an id and persists it", async () => {
    const created = await toteService.saveTote(
      { name: "Camping Gear", position: "B3", items: [] },
      true
    );
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Camping Gear");
    expect(created.position).toBe("B3");

    const stored = readStore();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(created.id);
  });

  it("throws when creating a second tote at the same position", async () => {
    await toteService.saveTote(
      { name: "Camping Gear", position: "B3", items: [] },
      true
    );
    await expect(
      toteService.saveTote({ name: "Sports Gear", position: "B3", items: [] }, true)
    ).rejects.toThrow(/spot.*already.*tote/i);
  });

  it("saveTote(existing, false) updates an existing tote", async () => {
    const created = await toteService.saveTote(
      { name: "Camping Gear", position: "B3", items: [] },
      true
    );
    const updated = await toteService.saveTote(
      { ...created, name: "Renamed Gear" },
      false
    );
    expect(updated.name).toBe("Renamed Gear");

    const stored = readStore();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Renamed Gear");
  });

  it("throws when updating a tote id that doesn't exist", async () => {
    await expect(
      toteService.saveTote(
        { id: 999999, name: "Ghost Tote", position: "A1", items: [] },
        false
      )
    ).rejects.toThrow(/couldn't find/i);
  });

  it("deleteTote soft-deletes: the tote leaves the walls but stays as a tombstone", async () => {
    const created = await toteService.saveTote(
      { name: "Camping Gear", position: "B3", items: [] },
      true
    );
    await toteService.deleteTote(created.id);

    const stored = readStore();
    expect(stored).toHaveLength(1);
    expect(stored[0].position).toBe(`__deleted__:B3:${created.id}`);

    const result = await toteService.getTotes();
    expect(result.data).toHaveLength(0);
    expect(result.deleted.map((d) => d.id)).toEqual([created.id]);
  });
});
