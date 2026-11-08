import { describe, expect, it } from "vitest";
import { highlightMatches, searchTotes } from "../search";

const names = (results) =>
  results.map((r) => (r.type === "item" ? r.item.name : r.tote.name));

describe("ranking", () => {
  const list = [
    {
      id: 1,
      name: "Bin",
      position: "A1",
      items: [
        { id: "x", name: "Hamer" },
        { id: "t", name: "Hammer" },
        { id: "p", name: "Hammerhead Shark Toy" },
        { id: "e", name: "Hammers" },
      ],
    },
  ];

  it("ranks exact word > word prefix > typo", () => {
    expect(names(searchTotes(list, "hammer"))).toEqual([
      "Hammer",
      "Hammers", // prefix (shorter name wins the tie)
      "Hammerhead Shark Toy",
      "Hamer", // typo
    ]);
  });

  it("ranks exact word > singular/plural > typo", () => {
    expect(names(searchTotes(list, "hammers"))).toEqual([
      "Hammers",
      "Hammer", // singular of the plural query
      "Hamer", // typo
    ]);
  });

  it("ranks tote-name matches alongside item matches", () => {
    const list = [
      {
        id: 1,
        name: "Camping Gear",
        position: "A1",
        items: [
          { id: "a", name: "Rope" },
          { id: "b", name: "Tent Pegs" },
        ],
      },
      {
        id: 2,
        name: "Garage Odds",
        position: "A2",
        items: [{ id: "c", name: "Camping Stove Fuel Canister" }],
      },
    ];
    const results = searchTotes(list, "camping");
    // The tote named "Camping Gear" outranks the long item name, and shows
    // even though none of its own items matched.
    expect(results.map((r) => r.type)).toEqual(["tote", "item"]);
    expect(results[0].tote.name).toBe("Camping Gear");
  });

  it("still lists a tote when one of its items also matches", () => {
    const list = [
      {
        id: 1,
        name: "Lantern Box",
        position: "A1",
        items: [{ id: "a", name: "Lantern" }],
      },
    ];
    const results = searchTotes(list, "lantern");
    expect(results.map((r) => r.type)).toEqual(["item", "tote"]);
  });

  it("scores results", () => {
    const list = [
      { id: 1, name: "Bin", position: "A1", items: [{ id: "a", name: "Lantern" }] },
    ];
    expect(searchTotes(list, "lantern")[0].score).toBeGreaterThan(0);
  });
});

describe("short tokens", () => {
  const list = [
    {
      id: 1,
      name: "Bin",
      position: "A1",
      items: [
        { id: "a", name: "Tent" },
        { id: "b", name: "Tool Chest" },
        { id: "c", name: "Cat Carrier" },
        { id: "d", name: "A" },
      ],
    },
  ];
  const itemNames = (q) =>
    searchTotes(list, q)
      .filter((r) => r.type === "item")
      .map((r) => r.item.name);

  it("only matches 1-2 letter words as a word prefix", () => {
    expect(itemNames("to")).toEqual(["Tool Chest"]);
    expect(itemNames("at")).toEqual([]); // mid-word in "Cat"
    expect(itemNames("e")).toEqual([]);
  });

  it("does not let a one-letter item name match a long query", () => {
    expect(itemNames("apple")).toEqual([]);
  });
});

describe("unicode and punctuation", () => {
  const list = [
    {
      id: 1,
      name: "Kitchen",
      position: "A1",
      items: [
        { id: "a", name: "Crème brûlée torch" },
        { id: "b", name: "Ёлка украшения" },
        { id: "c", name: "日本 茶碗" },
      ],
    },
  ];
  const itemNames = (q) =>
    searchTotes(list, q)
      .filter((r) => r.type === "item")
      .map((r) => r.item.name);

  it("strips accents on both sides", () => {
    expect(itemNames("creme brulee")).toEqual(["Crème brûlée torch"]);
    expect(itemNames("crème")).toEqual(["Crème brûlée torch"]);
  });

  it("tokenizes non-Latin letters instead of dropping them", () => {
    expect(itemNames("украшения")).toEqual(["Ёлка украшения"]);
    expect(itemNames("茶碗")).toEqual(["日本 茶碗"]);
  });

  it("splits on punctuation", () => {
    expect(itemNames("torch,")).toEqual(["Crème brûlée torch"]);
    expect(itemNames("(creme)")).toEqual(["Crème brûlée torch"]);
  });

  it("returns nothing for an all-punctuation query", () => {
    expect(searchTotes(list, "!!!")).toEqual([]);
    expect(searchTotes(list, "- . ,")).toEqual([]);
  });
});

describe("highlightMatches", () => {
  const matched = (text, q) =>
    highlightMatches(text, q)
      .filter((s) => s.match)
      .map((s) => s.text);

  it("bolds whole matched words and preserves the text", () => {
    const segs = highlightMatches("Camping Gear Bag", "gear");
    expect(segs).toEqual([
      { text: "Camping ", match: false },
      { text: "Gear", match: true },
      { text: " Bag", match: false },
    ]);
  });

  it("matches prefixes, plurals, accents, and typos", () => {
    expect(matched("Hammerhead Toy", "hamm")).toEqual(["Hammerhead"]);
    expect(matched("Lantern", "lanterns")).toEqual(["Lantern"]);
    expect(matched("Crème Brûlée", "creme")).toEqual(["Crème"]);
    expect(matched("Skeleton Prop", "skelton")).toEqual(["Skeleton"]);
  });

  it("highlights every word a multi-word query matched", () => {
    expect(matched("Red Camping Tent", "tent red")).toEqual(["Red", "Tent"]);
  });

  it("does not highlight short mid-word hits or empty queries", () => {
    expect(matched("Cat", "at")).toEqual([]);
    expect(matched("Cat", "")).toEqual([]);
    expect(highlightMatches("", "cat")).toEqual([]);
  });
});
