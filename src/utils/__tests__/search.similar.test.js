import { describe, expect, it } from "vitest";
import { findSimilarItems, sameItemName } from "../search";

describe("sameItemName", () => {
  it("ignores case, accents, spacing and punctuation", () => {
    expect(sameItemName("Bungee Cords", "bungee   cords")).toBe(true);
    expect(sameItemName("Café lights", "cafe LIGHTS!")).toBe(true);
  });

  it("treats singular and plural as the same", () => {
    expect(sameItemName("Bungee cord", "bungee cords")).toBe(true);
    expect(sameItemName("Batteries", "Battery")).toBe(true);
    expect(sameItemName("Box", "boxes")).toBe(true);
  });

  it("needs the whole name, in order", () => {
    expect(sameItemName("Bungee", "Bungee cords")).toBe(false);
    expect(sameItemName("cords bungee", "bungee cords")).toBe(false);
    expect(sameItemName("Tarp", "Tape")).toBe(false);
  });

  it("is false for empty or non-text input", () => {
    expect(sameItemName("", "")).toBe(false);
    expect(sameItemName(null, undefined)).toBe(false);
    expect(sameItemName("!!!", "!!!")).toBe(false);
  });
});

const totes = [
  { id: 1, name: "Camping", position: "A1", items: [{ id: 7, name: "Bungee cords", qty: 3 }] },
  {
    id: "t-2",
    name: "Garage Odds",
    position: "A2",
    items: [{ id: "u-1", name: "bungee cord", qty: 1 }, null, { id: "u-2", name: "Tarp" }],
  },
  { id: 3, name: "Workshop", position: "B1", items: [{ id: 9, name: "Bungee Cords" }] },
  { id: 99, name: "Bin", position: "__removed_items__", items: [{ id: 5, name: "Bungee cords" }] },
  { id: 100, name: "Gone", position: "__deleted__:A9:100", items: [{ id: 6, name: "Tarp" }] },
];

describe("findSimilarItems", () => {
  it("finds same-named items with their totes, in tote order", () => {
    const found = findSimilarItems(totes, "bungee cord", { limit: 5 });
    expect(found.map((f) => [f.tote.id, f.item.id])).toEqual([
      [1, 7],
      ["t-2", "u-1"],
      [3, 9],
    ]);
  });

  it("limits to two matches by default and honours limit", () => {
    expect(findSimilarItems(totes, "Bungee cords")).toHaveLength(2);
    expect(findSimilarItems(totes, "Bungee cords", { limit: 1 })).toHaveLength(1);
    expect(findSimilarItems(totes, "Bungee cords", { limit: 0 })).toEqual([]);
  });

  it("excludes the current tote by its original id type", () => {
    const found = findSimilarItems(totes, "bungee cords", { excludeToteId: 1, limit: 5 });
    expect(found.map((f) => f.tote.id)).toEqual(["t-2", 3]);
    // a string "1" is a different id than the number 1 - never stringified
    const other = findSimilarItems(totes, "bungee cords", { excludeToteId: "1", limit: 5 });
    expect(other.map((f) => f.tote.id)).toEqual([1, "t-2", 3]);
    expect(findSimilarItems(totes, "tarp", { excludeToteId: "t-2" })).toEqual([]);
  });

  it("ignores reserved rows and malformed items", () => {
    const found = findSimilarItems(totes, "tarp", { limit: 10 });
    expect(found.map((f) => f.tote.id)).toEqual(["t-2"]);
  });

  it("matches nothing for empty or one-character text", () => {
    expect(findSimilarItems(totes, "")).toEqual([]);
    expect(findSimilarItems(totes, "a")).toEqual([]);
    expect(findSimilarItems(null, "tarp")).toEqual([]);
  });
});
