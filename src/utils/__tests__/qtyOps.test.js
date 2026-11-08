import { describe, expect, it } from "vitest";
import { reconcileQtyOp, setQty } from "../qtyOps";

const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: 7, name: "Rope", qty: 1 }; // numeric id (live data mixes both)
const legacy = { id: "i3", name: "Tarp" }; // no qty → counts as 1

describe("setQty", () => {
  it("sets exactly that quantity, idempotently, matching ids without stringifying", () => {
    const op = setQty(7, 4);
    const once = op([lantern, rope]);
    expect(once).toEqual([lantern, { ...rope, qty: 4 }]);
    expect(op(once)).toEqual(once);
    expect(setQty("7", 4)([rope])).toEqual([rope]); // "7" !== 7
  });

  it("clamps to a non-negative integer and ignores missing items", () => {
    expect(setQty("i1", -3)([lantern])[0].qty).toBe(0);
    expect(setQty("i1", "2.6")([lantern])[0].qty).toBe(3);
    expect(setQty("nope", 9)([lantern])).toEqual([lantern]);
    expect(setQty("i1", 1)(null)).toEqual([]);
  });
});

describe("reconcileQtyOp", () => {
  it("returns null when every shared item already agrees", () => {
    expect(reconcileQtyOp([lantern, rope], [rope, lantern])).toBeNull();
    expect(reconcileQtyOp([], [lantern])).toBeNull();
    expect(reconcileQtyOp(undefined, [lantern])).toBeNull();
  });

  it("brings only differing shared items to the snapshot's qty", () => {
    const op = reconcileQtyOp(
      [{ ...lantern, qty: 3 }, { ...rope, qty: 1 }],
      [lantern, rope]
    );
    expect(op([lantern, rope])).toEqual([{ ...lantern, qty: 3 }, rope]);
  });

  it("never resurrects an item the other phone removed, nor touches one it added", () => {
    const added = { id: "new", name: "Stakes", qty: 5 };
    const op = reconcileQtyOp(
      [{ ...lantern, qty: 3 }, rope], // rope was removed meanwhile
      [lantern, added]
    );
    expect(op([lantern, added])).toEqual([{ ...lantern, qty: 3 }, added]);
  });

  it("treats a missing qty as 1 on both sides", () => {
    expect(reconcileQtyOp([legacy], [{ ...legacy, qty: 1 }])).toBeNull();
    const op = reconcileQtyOp([{ ...legacy, qty: 2 }], [legacy]);
    expect(op([legacy])).toEqual([{ ...legacy, qty: 2 }]);
  });
});
