import { describe, expect, it } from "vitest";
import {
  addItem,
  adjustQty,
  composeOps,
  diffItemsOp,
  itemQty,
  normalizeItems,
  removeItem,
  restoreItem,
  setItemImage,
} from "../itemOps";

const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };
const base = [lantern, rope];

describe("itemOps (pure, idempotent item operations)", () => {
  it("itemQty defaults legacy items without qty to 1 and rejects junk", () => {
    expect(itemQty({ qty: 4 })).toBe(4);
    expect(itemQty({})).toBe(1);
    expect(itemQty({ qty: "x" })).toBe(1);
    expect(itemQty({ qty: -3 })).toBe(1);
    expect(itemQty(null)).toBe(1);
  });

  it("addItem appends once — re-applying after a retry never duplicates", () => {
    const tape = { id: "i3", name: "Tape", qty: 1 };
    const once = addItem(tape)(base);
    expect(once.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(addItem(tape)(once)).toBe(once);
  });

  it("removeItem drops by id and is a no-op when already gone", () => {
    expect(removeItem("i1")(base)).toEqual([rope]);
    expect(removeItem("nope")(base)).toEqual(base);
  });

  it("adjustQty applies a delta clamped at zero and ignores unknown ids", () => {
    expect(adjustQty("i1", 3)(base)[0].qty).toBe(5);
    expect(adjustQty("i1", -10)(base)[0].qty).toBe(0);
    expect(adjustQty("i2", -1)(base)[1].qty).toBe(0);
    expect(adjustQty("ghost", 1)(base)).toEqual(base);
    // legacy item without qty counts as 1
    expect(adjustQty("x", 1)([{ id: "x", name: "Old" }])[0].qty).toBe(2);
  });

  it("restoreItem puts an item back at its index, clamps, and is idempotent", () => {
    expect(restoreItem(lantern, 0)([rope]).map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(restoreItem(lantern, 99)([rope]).map((i) => i.id)).toEqual(["i2", "i1"]);
    expect(restoreItem(lantern, -1)([rope]).map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(restoreItem(lantern, 0)(base)).toBe(base);
  });

  it("setItemImage replaces only the given item's photo", () => {
    const next = setItemImage("i1", "https://cdn/x.jpg")(base);
    expect(next[0].image).toBe("https://cdn/x.jpg");
    expect(next[1]).toBe(rope);
  });

  it("composeOps applies in order; ops tolerate a non-array input", () => {
    const op = composeOps(adjustQty("i1", 1), removeItem("i2"), addItem(rope));
    expect(op(base)).toEqual([{ ...lantern, qty: 3 }, rope]);
    expect(composeOps()(null)).toEqual([]);
    expect(adjustQty("i1", 1)(undefined)).toEqual([]);
  });

  it("diffItemsOp expresses form adds/removes without touching other items", () => {
    const opened = [lantern, rope];
    const tape = { id: "i3", name: "Tape", qty: 1 };
    const inForm = [rope, tape]; // removed Lantern, added Tape

    const op = diffItemsOp(opened, inForm);
    // Meanwhile the other phone bumped Rope and added Glue
    const live = [lantern, { ...rope, qty: 7 }, { id: "i4", name: "Glue", qty: 1 }];
    expect(op(live)).toEqual([{ ...rope, qty: 7 }, { id: "i4", name: "Glue", qty: 1 }, tape]);
  });

  it("diffItemsOp returns null when the form didn't touch items", () => {
    expect(diffItemsOp(base, [...base])).toBeNull();
    expect(diffItemsOp(null, [])).toBeNull();
  });

  it("normalizeItems drops non-object junk but keeps items", () => {
    expect(normalizeItems([lantern, null, 3, "x"])).toEqual([lantern]);
    expect(normalizeItems("nope")).toEqual([]);
  });
});
