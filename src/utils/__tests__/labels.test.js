import { describe, expect, it } from "vitest";
import { buildLabels } from "../labels";

const totes = [
  { id: 1, name: "Camping", position: "A3" },
  { id: 2, name: "Dup", position: "A3" },
  { id: 3, name: "Tools", position: "B3" },
];
const origin = "https://totes.example";

describe("buildLabels slot mode", () => {
  it("falls back to distinct tote positions without a positions list", () => {
    const l = buildLabels({ totes, origin, slotMode: true });
    expect(l.map((x) => x.title)).toEqual(["A3", "B3"]);
  });

  it("uses the full positions list, so empty slots get labels", () => {
    const l = buildLabels({
      totes,
      origin,
      slotMode: true,
      positions: ["A3", "A4", "B3", "A4", "__config__", ""],
    });
    expect(l.map((x) => x.url)).toEqual([
      "https://totes.example/?slot=A3",
      "https://totes.example/?slot=A4",
      "https://totes.example/?slot=B3",
    ]);
  });

  it("does not change tote labels when positions is given", () => {
    const l = buildLabels({ totes, origin, positions: ["Z9"] });
    expect(l).toHaveLength(3);
  });
});
