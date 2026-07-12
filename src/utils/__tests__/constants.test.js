import { describe, expect, it } from "vitest";
import {
  SHELF_POSITIONS,
  WALLS,
  describePosition,
  getWallForPosition,
} from "../constants";

function fixtureSlots(fixture) {
  if (fixture.slots) return fixture.slots;
  if (fixture.rows) return fixture.rows.flat().filter(Boolean);
  return [];
}

describe("SHELF_POSITIONS", () => {
  it("has 36 unique entries", () => {
    expect(SHELF_POSITIONS).toHaveLength(36);
    expect(new Set(SHELF_POSITIONS).size).toBe(36);
  });

  it("contains every WALLS fixture slot", () => {
    WALLS.forEach((wall) => {
      wall.fixtures.forEach((fixture) => {
        fixtureSlots(fixture).forEach((pos) => {
          expect(SHELF_POSITIONS).toContain(pos);
        });
      });
    });
  });
});

describe("describePosition", () => {
  it("describes a front-wall rack position", () => {
    const { wallId, path } = describePosition("A3");
    expect(wallId).toBe("front");
    expect(path).toContain("Front wall");
    expect(path).toContain("Level 3");
  });

  it("describes a left wall shelf position", () => {
    const { wallId, path } = describePosition("LW2");
    expect(wallId).toBe("left");
    expect(path).toContain("Shelf 2");
  });

  it("returns null wallId and the raw input for an unknown position", () => {
    const result = describePosition("Z9");
    expect(result).toEqual({ wallId: null, path: "Z9" });
  });
});

describe("getWallForPosition", () => {
  it("finds the right wall for RW1", () => {
    expect(getWallForPosition("RW1").id).toBe("right");
  });

  it("returns null for an unknown position", () => {
    expect(getWallForPosition("Z9")).toBeNull();
  });
});
