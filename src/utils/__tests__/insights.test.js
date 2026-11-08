import { describe, expect, it } from "vitest";
import { restockItems } from "../insights";

const tote = (id, position, items) => ({ id, name: `Tote ${id}`, position, items });

describe("restockItems", () => {
  it("lists only items at quantity 0", () => {
    const totes = [
      tote(1, "A1", [
        { id: 1, name: "Empty", qty: 0 },
        { id: 2, name: "Some", qty: 3 },
        { id: "u-1", name: "Gone", qty: 0 },
      ]),
    ];
    const result = restockItems(totes);
    expect(result.map((r) => r.item.name)).toEqual(["Empty", "Gone"]);
    expect(result[0].tote).toBe(totes[0]);
  });

  it("treats a missing qty as 1, so it is not listed", () => {
    const totes = [
      tote(1, "A1", [{ id: 1, name: "Legacy" }, { id: 2, name: "X", qty: undefined }]),
    ];
    expect(restockItems(totes)).toEqual([]);
  });

  it("keeps the original id value (number or string)", () => {
    const totes = [
      tote(1, "A1", [
        { id: 7, name: "N", qty: 0 },
        { id: "abc", name: "S", qty: 0 },
      ]),
    ];
    expect(restockItems(totes).map((r) => r.item.id)).toEqual([7, "abc"]);
  });

  it("ignores hidden duplicates when given the visible totes only", () => {
    const hidden = tote(1, "A1", [{ id: 1, name: "Stale", qty: 0 }]);
    const visible = tote(2, "A1", [{ id: 1, name: "Stale", qty: 2 }]);
    const byPosition = { A1: visible };
    expect(restockItems([hidden, visible])).toHaveLength(1); // a raw list would leak
    expect(restockItems(Object.values(byPosition))).toEqual([]);
  });

  it("sorts by tote position, numeric-aware", () => {
    const zero = [{ id: 1, name: "i", qty: 0 }];
    const totes = [
      tote(1, "RW1", zero),
      tote(2, "LW10", zero),
      tote(3, "LW2", zero),
      tote(4, "B3", zero),
      tote(5, "A1", zero),
    ];
    expect(restockItems(totes).map((r) => r.tote.position)).toEqual([
      "A1",
      "B3",
      "LW2",
      "LW10",
      "RW1",
    ]);
  });

  it("never lists the hidden config row and tolerates bad input", () => {
    const totes = [
      tote(1, "__config__", [{ id: 1, name: "c", qty: 0 }]),
      tote(2, "A1", null),
    ];
    expect(restockItems(totes)).toEqual([]);
    expect(restockItems(undefined)).toEqual([]);
  });
});
