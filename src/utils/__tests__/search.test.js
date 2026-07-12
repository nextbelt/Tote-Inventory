import { describe, expect, it } from "vitest";
import { searchTotes } from "../search";

const totes = [
  {
    id: 1,
    name: "Camping Gear",
    position: "B3",
    items: [{ id: "i1", name: "Lantern" }],
  },
  {
    id: 2,
    name: "Halloween Decorations",
    position: "A2",
    items: [{ id: "i2", name: "Skeleton" }],
  },
  {
    id: 3,
    name: "Sports Equipment",
    position: "LW1",
    items: [{ id: "i3", name: "Basketball" }],
  },
];

describe("searchTotes", () => {
  it("matches a partial word against a tote name", () => {
    const results = searchTotes(totes, "camp");
    expect(results.some((r) => r.tote.name === "Camping Gear")).toBe(true);
  });

  it("tolerates a typo in the query", () => {
    const results = searchTotes(totes, "campng");
    expect(results.some((r) => r.tote.name === "Camping Gear")).toBe(true);
  });

  it("tolerates a typo matching an item name", () => {
    const results = searchTotes(totes, "skelton");
    expect(
      results.some((r) => r.type === "item" && r.item.name === "Skeleton")
    ).toBe(true);
  });

  it("matches a plural query against a singular item name", () => {
    const results = searchTotes(totes, "basketballs");
    expect(
      results.some((r) => r.type === "item" && r.item.name === "Basketball")
    ).toBe(true);
  });

  it("matches a singular query against a plural-ish item name", () => {
    const plural = [
      {
        id: 4,
        name: "Toy Box",
        position: "A1",
        items: [{ id: "i4", name: "Basketballs" }],
      },
    ];
    const results = searchTotes(plural, "basketball");
    expect(
      results.some((r) => r.type === "item" && r.item.name === "Basketballs")
    ).toBe(true);
  });

  it("requires every token of a multi-token query to match", () => {
    const results = searchTotes(totes, "camping gear");
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => {
      expect(r.tote.name).toBe("Camping Gear");
    });

    const noMatch = searchTotes(totes, "camping basketball");
    expect(noMatch).toEqual([]);
  });

  it("returns an empty array for an empty query", () => {
    expect(searchTotes(totes, "")).toEqual([]);
    expect(searchTotes(totes, "   ")).toEqual([]);
  });

  it("sorts item matches before tote matches", () => {
    const mixed = [
      { id: 5, name: "Zebra Bin", position: "A4", items: [] },
      {
        id: 6,
        name: "Other Tote",
        position: "A5",
        items: [{ id: "i5", name: "Zebra Toy" }],
      },
    ];
    const results = searchTotes(mixed, "zebra");
    expect(results.length).toBe(2);
    expect(results[0].type).toBe("item");
    expect(results[1].type).toBe("tote");
  });

  it("result rows carry type, tote, and item", () => {
    const results = searchTotes(totes, "lantern");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "item",
      tote: totes[0],
      item: totes[0].items[0],
    });

    const toteResults = searchTotes(totes, "sports equipment");
    expect(toteResults).toHaveLength(1);
    expect(toteResults[0]).toMatchObject({ type: "tote", tote: totes[2] });
    expect(toteResults[0].item).toBeUndefined();
  });
});
