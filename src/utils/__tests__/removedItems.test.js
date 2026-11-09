import { describe, expect, it } from "vitest";
import { findToteHolding, visibleRemovedEntries } from "../removedItems";
import { dropRemovedEntriesFor } from "../reservedRows";

const entry = (toteId, item, removedAt = "2026-01-02T00:00:00.000Z") => ({
  id: `${toteId}:${item.id}:${removedAt}`,
  item,
  toteId,
  toteName: `Tote ${toteId}`,
  position: "A1",
  removedAt,
});

const lantern = { id: "i1", name: "Lantern" };
const rope = { id: 7, name: "Rope" };

describe("visibleRemovedEntries", () => {
  it("hides an entry when its item id is in ANY tote — home tote or another one — and keeps the rest", () => {
    const totes = [
      { id: 1, position: "A1", items: [{ id: "i9", name: "Other" }] }, // home, Lantern no longer here
      { id: 2, position: "B1", items: [lantern] }, // moved here after an Undo
    ];
    const stale = entry(1, lantern);
    const fine = entry(1, { id: "i2", name: "Tarp" });
    expect(visibleRemovedEntries([stale, fine], totes)).toEqual([fine]);
  });

  it("keeps an entry whose tote is gone and whose item lives nowhere; hides it once the item has a home", () => {
    const homeless = entry(99, lantern);
    expect(visibleRemovedEntries([homeless], [{ id: 1, items: [] }])).toEqual([homeless]);
    expect(visibleRemovedEntries([homeless], [{ id: 1, items: [lantern] }])).toEqual([]);
  });

  it("compares ids by original type: 7 is not \"7\"", () => {
    const totes = [{ id: 1, items: [{ id: "7", name: "String seven" }] }];
    expect(visibleRemovedEntries([entry(1, rope)], totes)).toHaveLength(1);
    expect(visibleRemovedEntries([entry(1, rope)], [{ id: 1, items: [rope] }])).toHaveLength(0);
  });

  it("tolerates malformed input", () => {
    expect(visibleRemovedEntries(null, null)).toEqual([]);
    expect(visibleRemovedEntries([null, {}, entry(1, lantern)], [{ id: 1 }, null])).toHaveLength(1);
  });
});

describe("findToteHolding", () => {
  it("returns the tote holding exactly that id, or null", () => {
    const a = { id: 1, items: [rope] };
    const b = { id: 2, items: [lantern] };
    expect(findToteHolding([a, b], "i1")).toBe(b);
    expect(findToteHolding([a, b], 7)).toBe(a);
    expect(findToteHolding([a, b], "7")).toBeNull();
    expect(findToteHolding([], "i1")).toBeNull();
    expect(findToteHolding(undefined, "i1")).toBeNull();
  });
});

describe("dropRemovedEntriesFor (bin op)", () => {
  it("drops only the entries about those items from that tote, ids by type; idempotent", () => {
    const list = [
      entry(1, lantern),
      entry(1, lantern, "2026-01-03T00:00:00.000Z"), // removed and undone twice → two entries
      entry(1, rope),
      entry(1, { id: "7", name: "String seven" }),
      entry(2, lantern),
      { id: "junk" }, // malformed, untouched
    ];
    const op = dropRemovedEntriesFor(1, ["i1", 7]);
    const out = op(list);
    expect(out.map((e) => e.id)).toEqual([list[3].id, list[4].id, "junk"]);
    expect(op(out)).toEqual(out);
    expect(dropRemovedEntriesFor("1", ["i1"])(list)).toEqual(list); // tote id by type too
    expect(dropRemovedEntriesFor(1, [])(list)).toEqual(list);
    expect(dropRemovedEntriesFor(1, ["i1"])(null)).toEqual([]);
  });
});
