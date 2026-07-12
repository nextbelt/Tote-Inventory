import { describe, expect, it } from "vitest";
import {
  buildWalls,
  DEFAULT_LAYOUT,
  describePosition,
  getWallIdForPosition,
  wallPositions,
} from "../constants";

describe("buildWalls", () => {
  it("defaults to 5 shelves per side wall (36 total positions)", () => {
    const walls = buildWalls(DEFAULT_LAYOUT);
    expect(walls.map((w) => w.id)).toEqual(["left", "front", "right"]);
    expect(walls[0].fixtures[0].slots).toEqual(["LW1", "LW2", "LW3", "LW4", "LW5"]);
    expect(wallPositions(walls)).toHaveLength(36);
  });

  it("respects custom shelf counts", () => {
    const walls = buildWalls({ leftShelves: 3, rightShelves: 8 });
    expect(walls[0].fixtures[0].slots).toEqual(["LW1", "LW2", "LW3"]);
    expect(walls[2].fixtures[0].slots).toHaveLength(8);
    expect(walls[2].fixtures[0].slots[7]).toBe("RW8");
  });

  it("never hides an occupied shelf, even if settings say fewer", () => {
    const walls = buildWalls({ leftShelves: 2, rightShelves: 5 }, ["LW4"]);
    expect(walls[0].fixtures[0].slots).toEqual(["LW1", "LW2", "LW3", "LW4"]);
  });

  it("front wall is unaffected by side-wall settings", () => {
    const walls = buildWalls({ leftShelves: 1, rightShelves: 1 });
    const front = walls[1];
    expect(front.fixtures).toHaveLength(3);
    expect(front.fixtures[0].rows.flat()).toContain("A5");
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

  it("still resolves front-wall rack positions", () => {
    expect(getWallIdForPosition("G4")).toBe("front");
    expect(describePosition("C5").path).toContain("Workbench");
  });

  it("returns null wall for unknown positions", () => {
    expect(getWallIdForPosition("Z9")).toBeNull();
    expect(describePosition("Z9")).toEqual({ wallId: null, path: "Z9" });
  });
});
