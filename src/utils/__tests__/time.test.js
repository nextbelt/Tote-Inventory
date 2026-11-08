import { describe, expect, it } from "vitest";
import { formatRelative, latestModified } from "../time";
import { WALLS } from "../constants";

describe("latestModified", () => {
  it("returns the newest updated_at (falling back to created_at)", () => {
    const d = latestModified([
      { updated_at: "2026-01-01T00:00:00Z" },
      { created_at: "2026-03-01T00:00:00Z" },
      { updated_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null when nothing has a timestamp", () => {
    expect(latestModified([])).toBeNull();
    expect(latestModified([{ updated_at: "garbage" }])).toBeNull();
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const ago = (ms) => new Date(now - ms);
  it.each([
    [10 * 1000, "just now"],
    [5 * 60 * 1000, "5 min ago"],
    [3 * 3600 * 1000, "3 hr ago"],
    [30 * 3600 * 1000, "yesterday"],
    [4 * 86400 * 1000, "4 days ago"],
  ])("%i ms ago → %s", (ms, expected) => {
    expect(formatRelative(ago(ms), now)).toBe(expected);
  });
});

describe("front wall order", () => {
  it("renders A/B, then F/G, then the C/D/E workbench (IDs unchanged)", () => {
    const front = WALLS.find((w) => w.id === "front");
    expect(front.fixtures.map((f) => f.id)).toEqual([
      "rack-ab",
      "rack-fg",
      "workbench",
    ]);
    expect(front.fixtures[2].rows.flat()).toEqual(["C4", "D4", "E4", "C5", "D5", "E5"]);
  });
});
