import { afterEach, describe, expect, it, vi } from "vitest";
import { tagColor, TAG_PALETTE_SIZE } from "../tagColors";
import {
  collectTags,
  filterTotes,
  hasOutOfStock,
  listableTotes,
  loadListPrefs,
  LIST_PREFS_KEY,
  saveListPrefs,
  sortTotes,
} from "../toteList";

const t = (id, name, position, extra = {}) => ({
  id,
  name,
  position,
  items: [],
  updated_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("sortTotes", () => {
  const totes = [
    t(1, "Zebra", "LW10", { updated_at: "2026-03-01T00:00:00.000Z" }),
    t(2, "apple", "LW2", { updated_at: "2026-05-01T00:00:00.000Z" }),
    t(3, "Mango", "A1", { updated_at: "2026-04-01T00:00:00.000Z" }),
    t("uuid-4", "Old", "B1", { updated_at: undefined, created_at: undefined }),
  ];

  it("sorts by spot, numeric aware (LW2 before LW10)", () => {
    expect(sortTotes(totes, "spot").map((x) => x.position)).toEqual([
      "A1",
      "B1",
      "LW2",
      "LW10",
    ]);
  });

  it("sorts newest change first, undated last", () => {
    expect(sortTotes(totes, "recent").map((x) => x.id)).toEqual([
      2,
      3,
      1,
      "uuid-4",
    ]);
  });

  it("sorts by name ignoring case", () => {
    expect(sortTotes(totes, "name").map((x) => x.name)).toEqual([
      "apple",
      "Mango",
      "Old",
      "Zebra",
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...totes];
    sortTotes(totes, "name");
    expect(totes).toEqual(copy);
  });
});

describe("filtering", () => {
  const totes = [
    t(1, "Winter", "A1", { tags: ["Seasonal", "Winter"] }),
    t(2, "Tools", "A2", {
      tags: ["tools"],
      items: [{ id: "u-1", name: "Drill", qty: 0 }],
    }),
    t(3, "Misc", "A3", { items: [{ id: 5, name: "Tape" }] }),
  ];

  it("detects quantity 0 only (missing qty counts as 1)", () => {
    expect(hasOutOfStock(totes[1])).toBe(true);
    expect(hasOutOfStock(totes[2])).toBe(false);
    expect(hasOutOfStock(totes[0])).toBe(false);
  });

  it("filters by tag, case-insensitively, matching any selected tag", () => {
    expect(filterTotes(totes, { tags: ["TOOLS"] }).map((x) => x.id)).toEqual([2]);
    expect(
      filterTotes(totes, { tags: ["winter", "tools"] }).map((x) => x.id)
    ).toEqual([1, 2]);
  });

  it("ignores tag selections when tags are not enabled", () => {
    expect(filterTotes(totes, { tags: ["tools"] }, false)).toHaveLength(3);
  });

  it("combines out of stock with tags", () => {
    expect(
      filterTotes(totes, { tags: ["winter"], outOfStock: true })
    ).toEqual([]);
    expect(filterTotes(totes, { outOfStock: true }).map((x) => x.id)).toEqual([2]);
  });

  it("collects distinct tags with counts, A to Z", () => {
    expect(collectTags(totes)).toEqual([
      { key: "seasonal", label: "Seasonal", count: 1 },
      { key: "tools", label: "tools", count: 1 },
      { key: "winter", label: "Winter", count: 1 },
    ]);
  });
});

describe("listableTotes", () => {
  it("drops reserved rows and junk", () => {
    const rows = [
      t(1, "Real", "A1"),
      t(2, "cfg", "__config__"),
      t(3, "bin", "__removed_items__"),
      t(4, "gone", "__deleted__:A2:4"),
      t(5, "swap", "__swap__1"),
      null,
      { id: 6, name: "No position" },
    ];
    expect(listableTotes(rows).map((x) => x.id)).toEqual([1]);
  });
});

describe("list prefs", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips through sessionStorage", () => {
    saveListPrefs({ sort: "name", tags: ["a"], outOfStock: true });
    expect(loadListPrefs()).toEqual({ sort: "name", tags: ["a"], outOfStock: true });
  });

  it("falls back to defaults on junk", () => {
    sessionStorage.setItem(LIST_PREFS_KEY, "{not json");
    expect(loadListPrefs()).toEqual({ sort: "spot", tags: [], outOfStock: false });
    sessionStorage.setItem(
      LIST_PREFS_KEY,
      JSON.stringify({ sort: "bogus", tags: "x", outOfStock: "yes" })
    );
    expect(loadListPrefs()).toEqual({ sort: "spot", tags: [], outOfStock: false });
  });

  it("does not throw when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveListPrefs({ sort: "name", tags: [], outOfStock: false })).not.toThrow();
    expect(loadListPrefs().sort).toBe("spot");
  });
});

describe("tagColor", () => {
  it("is stable and case-insensitive", () => {
    expect(tagColor("Winter")).toBe(tagColor("  winter "));
    expect(tagColor("Winter")).toBe(tagColor("Winter"));
  });

  it("spreads tags over several colours, each with light and dark classes", () => {
    const seen = new Set(
      ["tools", "winter", "xmas", "paint", "garden", "camp", "kids", "bikes", "car"].map(
        (tag) => tagColor(tag).chip
      )
    );
    expect(seen.size).toBeGreaterThan(2);
    expect(seen.size).toBeLessThanOrEqual(TAG_PALETTE_SIZE);
    seen.forEach((chip) => {
      expect(chip).toMatch(/\bbg-\w+-100\b/);
      expect(chip).toMatch(/\btext-\w+-900\b/);
      expect(chip).toMatch(/\bdark:bg-\w+-900\b/);
      expect(chip).toMatch(/\bdark:text-\w+-100\b/);
    });
  });
});
