import { describe, expect, it } from "vitest";
import {
  buildWalls,
  DEFAULT_LAYOUT,
  describePosition,
  getWallIdForPosition,
  parseSideSlot,
  sideSlotId,
  wallPositions,
} from "../constants";

const leftRows = (walls) => walls[0].fixtures[0].rows;
const frontWall = (walls) => walls.find((w) => w.id === "front");
const rightRows = (walls) => walls[2].fixtures[0].rows;

describe("buildWalls", () => {
  it("defaults to 5 shelves × 1 column per side wall (36 total positions)", () => {
    const walls = buildWalls(DEFAULT_LAYOUT);
    expect(walls.map((w) => w.id)).toEqual(["left", "front", "right"]);
    expect(leftRows(walls)).toEqual([["LW1"], ["LW2"], ["LW3"], ["LW4"], ["LW5"]]);
    expect(wallPositions(walls)).toHaveLength(36);
  });

  it("respects custom shelf counts", () => {
    const walls = buildWalls({ ...DEFAULT_LAYOUT, leftShelves: 3, rightShelves: 8 });
    expect(leftRows(walls).flat()).toEqual(["LW1", "LW2", "LW3"]);
    expect(rightRows(walls)).toHaveLength(8);
    expect(rightRows(walls)[7]).toEqual(["RW8"]);
  });

  it("adds lateral columns with letter-suffixed slot IDs", () => {
    const walls = buildWalls({ ...DEFAULT_LAYOUT, leftShelves: 2, leftColumns: 3 });
    expect(leftRows(walls)).toEqual([
      ["LW1", "LW1B", "LW1C"],
      ["LW2", "LW2B", "LW2C"],
    ]);
  });

  it("never hides an occupied shelf or column, even if settings say fewer", () => {
    const walls = buildWalls(
      { ...DEFAULT_LAYOUT, leftShelves: 2, leftColumns: 1 },
      ["LW4", "LW1C"]
    );
    expect(leftRows(walls)).toHaveLength(4); // LW4 occupied
    expect(leftRows(walls)[0]).toEqual(["LW1", "LW1B", "LW1C"]); // col C occupied
  });

  it("front wall is unaffected by side-wall settings", () => {
    const walls = buildWalls({ ...DEFAULT_LAYOUT, leftShelves: 1, rightShelves: 1 });
    const front = walls[1];
    expect(front.fixtures).toHaveLength(3);
    expect(front.fixtures[0].rows.flat()).toContain("A5");
  });
});

describe("side-slot IDs", () => {
  it("column 1 keeps the legacy ID; extra columns get letters", () => {
    expect(sideSlotId("LW", 3, 1)).toBe("LW3");
    expect(sideSlotId("LW", 3, 2)).toBe("LW3B");
    expect(sideSlotId("RW", 12, 4)).toBe("RW12D");
  });

  it("parseSideSlot round-trips", () => {
    expect(parseSideSlot("LW", "LW3")).toEqual({ shelf: 3, column: 1 });
    expect(parseSideSlot("LW", "LW3B")).toEqual({ shelf: 3, column: 2 });
    expect(parseSideSlot("LW", "RW3")).toBeNull();
    expect(parseSideSlot("LW", "LWx")).toBeNull();
  });
});

describe("pattern-based position helpers", () => {
  it("resolves side-wall shelves beyond the default count", () => {
    expect(getWallIdForPosition("LW9")).toBe("left");
    expect(getWallIdForPosition("RW12")).toBe("right");
    expect(describePosition("LW9")).toEqual({
      wallId: "left",
      path: "Left wall · Shelf 9",
    });
  });

  it("describes lateral slots with their letter", () => {
    expect(getWallIdForPosition("RW2C")).toBe("right");
    expect(describePosition("RW2C")).toEqual({
      wallId: "right",
      path: "Right wall · Shelf 2 · Slot C",
    });
  });

  it("still resolves front-wall rack positions", () => {
    expect(getWallIdForPosition("G4")).toBe("front");
    expect(describePosition("C5").path).toContain("Workbench");
  });

  it("returns null wall for unknown positions", () => {
    expect(getWallIdForPosition("Z9")).toBeNull();
    expect(describePosition("Z9")).toEqual({ wallId: null, path: "Z9" });
  });
});

describe("front wall", () => {
  it("renders A/B rack, then F/G rack, then the C/D/E workbench (IDs unchanged)", () => {
    const front = frontWall(buildWalls(DEFAULT_LAYOUT));
    expect(front.fixtures.map((f) => f.id)).toEqual([
      "rack-ab",
      "rack-fg",
      "workbench",
    ]);
    expect(front.fixtures[1].rows.flat()).toEqual([
      "F1", "G1", "F2", "G2", "F3", "G3", "F4", "G4", "F5", "G5",
    ]);
    expect(front.fixtures[2].rows.flat()).toEqual([
      "C4", "D4", "E4", "C5", "D5", "E5",
    ]);
  });

  it("describes F/G slots as the middle rack", () => {
    expect(describePosition("F3")).toEqual({
      wallId: "front",
      path: "Front wall · Middle rack · Level 3",
    });
    expect(describePosition("G5").path).toBe("Front wall · Middle rack · Level 5");
  });
});
