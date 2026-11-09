import { describe, expect, it } from "vitest";
import {
  applyTagDelta,
  diffTags,
  invertTagDelta,
  isEmptyDelta,
  sameTags,
} from "../tagOps";

describe("tagOps", () => {
  it("diffTags compares by exact string, so a capitalization fix is a remove + add", () => {
    expect(diffTags(["xmas", "kids"], ["kids", "Xmas"])).toEqual({
      added: ["Xmas"],
      removed: ["xmas"],
    });
    expect(diffTags(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });

  it("applyTagDelta removes case-insensitively, appends, and never duplicates a tag the list already has (first spelling wins)", () => {
    expect(
      applyTagDelta(["winter", "kids", "Fragile"], { added: ["outdoor", "fragile"], removed: ["KIDS"] })
    ).toEqual(["winter", "Fragile", "outdoor"]);
    // Their tag unknown to the caller survives
    expect(applyTagDelta(["Xmas"], { added: ["Lights"] })).toEqual(["Xmas", "Lights"]);
    // Normalizes what it is given
    expect(applyTagDelta([" a ", "A"], { added: ["  b   c "], removed: [] })).toEqual(["a", "b c"]);
    expect(applyTagDelta(undefined, undefined)).toEqual([]);
    // Junk in a delta is ignored, never thrown on
    expect(applyTagDelta(["a"], { added: [42, null, "b"], removed: [7, undefined] })).toEqual(["a", "b"]);
  });

  it("invertTagDelta undoes a delta; isEmptyDelta / sameTags helpers", () => {
    const delta = { added: ["Lights"], removed: ["kids"] };
    expect(invertTagDelta(delta)).toEqual({ added: ["kids"], removed: ["Lights"] });
    expect(applyTagDelta(applyTagDelta(["kids"], delta), invertTagDelta(delta))).toEqual(["kids"]);
    expect(isEmptyDelta({ added: [], removed: [] })).toBe(true);
    expect(isEmptyDelta(null)).toBe(true);
    expect(isEmptyDelta({ added: ["x"] })).toBe(false);
    expect(sameTags(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameTags(["a", "b"], ["b", "a"])).toBe(false);
  });
});
