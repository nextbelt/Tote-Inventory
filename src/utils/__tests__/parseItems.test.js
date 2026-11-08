import { describe, expect, it } from "vitest";
import {
  leftoverText,
  MAX_PARSED_ITEMS,
  parseItems,
} from "../parseItems";

const pairs = (text) =>
  parseItems(text).items.map(({ name, qty }) => [name, qty]);

describe("parseItems splitting", () => {
  it("handles the headline example", () => {
    expect(pairs("3 bungee cords, tarp, 2 straps")).toEqual([
      ["bungee cords", 3],
      ["tarp", 1],
      ["straps", 2],
    ]);
  });

  it("splits on newlines, commas and semicolons, dropping empties", () => {
    expect(pairs("hammer\nsaw; drill,, ,\r\n\n  level  ")).toEqual([
      ["hammer", 1],
      ["saw", 1],
      ["drill", 1],
      ["level", 1],
    ]);
  });

  it("never splits on 'and'", () => {
    expect(pairs("nuts and bolts, rope and pulley")).toEqual([
      ["nuts and bolts", 1],
      ["rope and pulley", 1],
    ]);
  });

  it("splits on full-width separators too", () => {
    expect(pairs("錘子，鋸子、3 螺絲刀")).toEqual([
      ["錘子", 1],
      ["鋸子", 1],
      ["螺絲刀", 3],
    ]);
  });

  it("returns nothing for empty or non-string input", () => {
    expect(parseItems("").items).toEqual([]);
    expect(parseItems("  ,; \n ").items).toEqual([]);
    expect(parseItems(undefined).items).toEqual([]);
    expect(parseItems(null).items).toEqual([]);
  });

  it("reports the text each item came from", () => {
    expect(parseItems("3 tarps. , rope").sources).toEqual(["3 tarps", "rope"]);
  });
});

describe("parseItems quantities", () => {
  it("reads a leading count", () => {
    expect(pairs("3 bungee cords")).toEqual([["bungee cords", 3]]);
    expect(pairs("12 AA batteries")).toEqual([["AA batteries", 12]]);
  });

  it("reads 3x / 3 x / 3X leading counts", () => {
    expect(pairs("3x tarp")).toEqual([["tarp", 3]]);
    expect(pairs("3xtarp")).toEqual([["tarp", 3]]);
    expect(pairs("3 x tarp")).toEqual([["tarp", 3]]);
    expect(pairs("3X tarp")).toEqual([["tarp", 3]]);
    expect(pairs("3× tarp")).toEqual([["tarp", 3]]);
  });

  it("reads trailing counts", () => {
    expect(pairs("tarp x2")).toEqual([["tarp", 2]]);
    expect(pairs("tarp x 2")).toEqual([["tarp", 2]]);
    expect(pairs("tarp × 4")).toEqual([["tarp", 4]]);
    expect(pairs("tarp (2)")).toEqual([["tarp", 2]]);
    expect(pairs("tarp(2)")).toEqual([["tarp", 2]]);
  });

  it("leaves dimensions, decimals and fractions alone", () => {
    expect(pairs("2x4 lumber")).toEqual([["2x4 lumber", 1]]);
    expect(pairs("1.5 L jug")).toEqual([["1.5 L jug", 1]]);
    expect(pairs("1/2 inch bolts")).toEqual([["1/2 inch bolts", 1]]);
    expect(pairs("3-pack batteries")).toEqual([["3-pack batteries", 1]]);
  });

  it("does not take an 'x' word for a multiplier", () => {
    expect(pairs("5 xylophones")).toEqual([["xylophones", 5]]);
    expect(pairs("Xbox")).toEqual([["Xbox", 1]]);
    expect(pairs("Alex2")).toEqual([["Alex2", 1]]);
  });

  it("keeps implausible counts in the name", () => {
    expect(pairs("0 tarps")).toEqual([["0 tarps", 1]]);
    expect(pairs("2024 calendar")).toEqual([["2024 calendar", 1]]);
    expect(pairs("1000 screws")).toEqual([["1000 screws", 1]]);
    expect(pairs("999 screws")).toEqual([["screws", 999]]);
  });

  it("keeps a number-only entry as the name", () => {
    expect(pairs("7")).toEqual([["7", 1]]);
    expect(pairs("3 4")).toEqual([["3 4", 1]]);
  });
});

describe("parseItems cleanup", () => {
  it("strips trailing periods (dictation) but not inner ones", () => {
    expect(pairs("Tarp.")).toEqual([["Tarp", 1]]);
    expect(pairs("2 straps.")).toEqual([["straps", 2]]);
    expect(pairs("tarp x2.")).toEqual([["tarp", 2]]);
    expect(pairs("tarp.. ")).toEqual([["tarp", 1]]);
    expect(pairs("Mr. Coffee maker.")).toEqual([["Mr. Coffee maker", 1]]);
    expect(pairs("rope. tarp.")).toEqual([["rope. tarp", 1]]);
    expect(pairs("rope.\ntarp.")).toEqual([
      ["rope", 1],
      ["tarp", 1],
    ]);
  });

  it("trims whitespace around names", () => {
    expect(pairs("   3    bungee   cords  ")).toEqual([["bungee   cords", 3]]);
  });

  it("copes with accents and other scripts", () => {
    expect(pairs("2 crème brûlée torches, café table")).toEqual([
      ["crème brûlée torches", 2],
      ["café table", 1],
    ]);
    expect(pairs("3 ñandú, Überzug x2, 3 工具箱")).toEqual([
      ["ñandú", 3],
      ["Überzug", 2],
      ["工具箱", 3],
    ]);
    expect(pairs("3 🔧 wrench")).toEqual([["🔧 wrench", 3]]);
  });
});

describe("parseItems limits and validation", () => {
  it("caps at 50 items and hands back the rest", () => {
    const text = Array.from({ length: 53 }, (_, i) => `item${i + 1}`).join(", ");
    const result = parseItems(text);
    expect(MAX_PARSED_ITEMS).toBe(50);
    expect(result.items).toHaveLength(50);
    expect(result.items[49].name).toBe("item50");
    expect(result.overflow).toEqual(["item51", "item52", "item53"]);
    expect(leftoverText(result)).toBe("item51\nitem52\nitem53");
  });

  it("exactly 50 items has no overflow", () => {
    const text = Array.from({ length: 50 }, (_, i) => `item${i}`).join("\n");
    const result = parseItems(text);
    expect(result.items).toHaveLength(50);
    expect(result.overflow).toEqual([]);
  });

  it("skips names that fail validation and reports them", () => {
    const long = "a".repeat(101);
    const result = parseItems(`rope, ${long}, 2 tarps`);
    expect(result.items.map((i) => i.name)).toEqual(["rope", "tarps"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].text).toBe(long);
    expect(result.skipped[0].error).toMatch(/100 characters/);
    expect(leftoverText(result)).toBe(long);
  });

  it("accepts a name of exactly 100 characters", () => {
    expect(parseItems("a".repeat(100)).items).toHaveLength(1);
  });

  it("validates the name without its count", () => {
    const name = "b".repeat(100);
    const result = parseItems(`3 ${name}`);
    expect(result.items).toEqual([{ name, qty: 3 }]);
    expect(result.skipped).toEqual([]);
  });

  it("skipped entries do not use up the cap", () => {
    const long = "a".repeat(101);
    const text = [long, ...Array.from({ length: 50 }, (_, i) => `i${i}`)].join(",");
    const result = parseItems(text);
    expect(result.items).toHaveLength(50);
    expect(result.skipped).toHaveLength(1);
    expect(result.overflow).toEqual([]);
  });
});
