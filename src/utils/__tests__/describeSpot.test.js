import { describe, expect, it } from "vitest";
import { buildWalls, describePosition, describeSpot } from "../constants";

describe("describeSpot", () => {
  const walls = buildWalls();

  it("describes rack shelves from the top, with the bin side", () => {
    expect(describeSpot("A1", walls)).toBe(
      "Front wall · Left rack · top shelf · left bin"
    );
    expect(describeSpot("B3", walls)).toBe(
      "Front wall · Left rack · shelf 3 of 5 · right bin"
    );
    expect(describeSpot("G5", walls)).toBe(
      "Front wall · Middle rack · bottom shelf · right bin"
    );
  });

  it("describes the workbench floor and under-bench rows", () => {
    expect(describeSpot("D5", walls)).toBe("Front wall · Workbench · floor, middle");
    expect(describeSpot("C5", walls)).toBe("Front wall · Workbench · floor, left");
    expect(describeSpot("E4", walls)).toBe(
      "Front wall · Workbench · under the bench, right"
    );
  });

  it("uses the user's shelf count on side walls", () => {
    expect(describeSpot("LW2", walls)).toBe("Left wall · shelf 2 of 5");
    const custom = buildWalls({
      leftShelves: 3,
      leftColumns: 1,
      rightShelves: 8,
      rightColumns: 2,
    });
    expect(describeSpot("LW2", custom)).toBe("Left wall · shelf 2 of 3");
    expect(describeSpot("RW6", custom)).toBe("Right wall · shelf 6 of 8 · left bin");
    expect(describeSpot("RW6B", custom)).toBe("Right wall · shelf 6 of 8 · right bin");
  });

  it("keeps an occupied slot beyond the configured count readable", () => {
    const shrunk = buildWalls({ leftShelves: 2 }, ["LW4"]);
    expect(describeSpot("LW4", shrunk)).toBe("Left wall · shelf 4 of 4");
  });

  it("falls back to describePosition wording for unknown positions", () => {
    expect(describeSpot("Z9", walls)).toBe("Z9");
    expect(describeSpot("LW99", walls)).toBe(describePosition("LW99").path);
  });

  it("defaults to the default walls and leaves describePosition alone", () => {
    expect(describeSpot("LW1")).toBe("Left wall · shelf 1 of 5");
    expect(describePosition("A3").path).toBe("Front wall · Left rack · Level 3");
  });
});
