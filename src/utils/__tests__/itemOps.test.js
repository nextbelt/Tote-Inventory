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
  updateItem,
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

  describe("updateItem", () => {
    it("shallow-merges only name / image / qty into the matching item", () => {
      const next = updateItem("i1", {
        name: "Big lantern",
        image: "https://cdn/l.jpg",
        qty: 5,
        id: "hacked",
        position: "A1",
      })(base);
      expect(next[0]).toEqual({
        id: "i1",
        name: "Big lantern",
        image: "https://cdn/l.jpg",
        qty: 5,
      });
      expect(next[1]).toBe(rope); // untouched items keep identity
    });

    it("only touches the fields that were given (a partial edit never erases the rest)", () => {
      const next = updateItem("i1", { qty: 7 })([{ ...lantern, image: "x.jpg" }]);
      expect(next[0]).toEqual({ ...lantern, image: "x.jpg", qty: 7 });
      // image: null is a real edit (remove the photo), not an omission
      expect(updateItem("i1", { image: null })([{ ...lantern, image: "x.jpg" }])[0].image).toBeNull();
    });

    it("qty is an absolute set clamped at zero; junk qty is ignored", () => {
      expect(updateItem("i1", { qty: 0 })(base)[0].qty).toBe(0);
      expect(updateItem("i1", { qty: -4 })(base)[0].qty).toBe(0);
      expect(updateItem("i1", { qty: "3" })(base)[0].qty).toBe(3);
      expect(updateItem("i1", { qty: "lots" })(base)).toBe(base);
      expect(updateItem("i1", { qty: NaN, name: "Lamp" })(base)[0]).toEqual({ ...lantern, name: "Lamp" });
    });

    it("is a no-op when the id is gone or nothing editable was given", () => {
      expect(updateItem("ghost", { name: "x" })(base)).toEqual(base);
      expect(updateItem("i1", {})(base)).toBe(base);
      expect(updateItem("i1", null)(base)).toBe(base);
      expect(updateItem("i1", { name: "x" })(undefined)).toEqual([]);
    });

    it("matches ids strictly — numeric and string ids never cross over", () => {
      const mixed = [
        { id: 7, name: "Legacy", qty: 1 },
        { id: "7", name: "Uuid-ish", qty: 1 },
        { id: "0b1c", name: "Uuid", qty: 2 },
      ];
      expect(updateItem(7, { name: "Edited" })(mixed).map((i) => i.name)).toEqual([
        "Edited",
        "Uuid-ish",
        "Uuid",
      ]);
      expect(updateItem("7", { name: "Edited" })(mixed).map((i) => i.name)).toEqual([
        "Legacy",
        "Edited",
        "Uuid",
      ]);
      expect(updateItem("0b1c", { qty: 9 })(mixed)[2].qty).toBe(9);
    });

    it("is idempotent, so a CAS retry re-applying it changes nothing more", () => {
      const op = updateItem("i1", { name: "Lamp", qty: 3 });
      const once = op(base);
      expect(op(once)).toEqual(once);
    });

    describe("note", () => {
      const noted = [
        { id: 7, name: "Legacy", qty: 1, note: "old note" },
        { id: "7", name: "Uuid-ish", qty: 1 },
      ];

      it("sets a trimmed note on the matching item only — numeric and string ids never cross over", () => {
        const byNumber = updateItem(7, { note: "  needs batteries  " })(noted);
        expect(byNumber[0]).toEqual({ id: 7, name: "Legacy", qty: 1, note: "needs batteries" });
        expect(byNumber[1]).toBe(noted[1]); // "7" untouched (identity kept)

        const byString = updateItem("7", { note: "left glove only" })(noted);
        expect(byString[0]).toBe(noted[0]);
        expect(byString[1]).toEqual({ id: "7", name: "Uuid-ish", qty: 1, note: "left glove only" });
      });

      it("an empty, blank or null note REMOVES the key (never stores note: '')", () => {
        expect(updateItem(7, { note: "" })(noted)[0]).toEqual({ id: 7, name: "Legacy", qty: 1 });
        expect(updateItem(7, { note: "   " })(noted)[0]).toEqual({ id: 7, name: "Legacy", qty: 1 });
        expect(updateItem(7, { note: null })(noted)[0]).toEqual({ id: 7, name: "Legacy", qty: 1 });
        expect(updateItem(7, { note: undefined })(noted)[0]).toEqual({ id: 7, name: "Legacy", qty: 1 });
        // Clearing a note that isn't there is harmless (idempotent, no key added)
        expect("note" in updateItem("7", { note: null })(noted)[1]).toBe(false);
      });

      it("a non-string note is treated as a clear, and travels alongside other fields", () => {
        const next = updateItem(7, { name: "Drill", qty: 2, note: 42 })(noted);
        expect(next[0]).toEqual({ id: 7, name: "Drill", qty: 2 });
      });

      it("a note edit never touches the other fields, and vice versa", () => {
        const withPhoto = [{ ...lantern, image: "x.jpg", note: "keep" }];
        expect(updateItem("i1", { note: "new" })(withPhoto)[0]).toEqual({
          ...lantern,
          image: "x.jpg",
          note: "new",
        });
        expect(updateItem("i1", { qty: 9 })(withPhoto)[0].note).toBe("keep");
      });
    });
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
