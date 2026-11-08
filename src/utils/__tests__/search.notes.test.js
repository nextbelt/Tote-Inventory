import { describe, expect, it } from "vitest";
import { searchTotes, snippetAround } from "../search";

const totes = [
  {
    id: 1,
    name: "Camping",
    position: "A1",
    tags: ["outdoor", "summer"],
    notes: "Check the stove before every trip",
    items: [
      { id: 1, name: "Lantern", note: "needs new mantles" },
      { id: "u1", name: "Mantles box" },
    ],
  },
  {
    id: 2,
    name: "Mantles Shelf",
    position: "A2",
    items: [{ id: 2, name: "Rope" }],
  },
];

describe("search over notes and tags", () => {
  it("matches an item note and reports it", () => {
    const hits = searchTotes([totes[0]], "new mantles").filter((r) => r.match);
    expect(hits).toHaveLength(1);
    expect(hits[0].type).toBe("item");
    expect(hits[0].item.name).toBe("Lantern");
    expect(hits[0].match).toEqual({ field: "note", text: "needs new mantles" });
  });

  it("matches tote notes and tags", () => {
    const notes = searchTotes(totes, "stove");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "tote", match: { field: "notes" } });

    const tags = searchTotes(totes, "summer");
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ type: "tote", match: { field: "tag", text: "summer" } });
  });

  it("does not combine words from two different tags", () => {
    expect(searchTotes(totes, "outdoor summer")).toEqual([]);
  });

  it("ranks note/tag matches below every name match", () => {
    const results = searchTotes(totes, "mantles");
    // "Mantles box" item and "Mantles Shelf" tote by name first, note match last
    expect(results.map((r) => Boolean(r.match))).toEqual([false, false, true]);
    expect(results[2].item.name).toBe("Lantern");
  });

  it("even a typo-quality name match outranks an exact note match", () => {
    const list = [
      { id: 1, name: "A", position: "A1", items: [{ id: 1, name: "Wrench", note: "lantern" }] },
      { id: 2, name: "B", position: "A2", items: [{ id: 2, name: "Lantren" }] },
    ];
    const results = searchTotes(list, "lantern");
    expect(results.map((r) => r.item.name)).toEqual(["Lantren", "Wrench"]);
    expect(results[0].match).toBeUndefined();
    expect(results[1].match.field).toBe("note");
  });

  it("a name match wins over the note of the same item (no snippet)", () => {
    const results = searchTotes(
      [{ id: 1, name: "T", position: "A1", items: [{ id: 1, name: "Rope", note: "rope for the boat" }] }],
      "rope"
    );
    expect(results).toHaveLength(1);
    expect(results[0].match).toBeUndefined();
  });

  it("ignores malformed notes and tags", () => {
    const odd = [
      { id: 1, name: "A", position: "A1", tags: "nope", notes: 5, items: [{ id: 1, name: "x", note: { a: 1 } }] },
    ];
    expect(searchTotes(odd, "nope")).toEqual([]);
  });

  it("keeps result objects free of internal ranking fields", () => {
    const [r] = searchTotes(totes, "stove");
    expect(Object.keys(r).sort()).toEqual(["match", "score", "tote", "type"]);
  });
});

describe("snippetAround", () => {
  it("returns short text whole", () => {
    expect(snippetAround("short note", "note")).toBe("short note");
  });

  it("windows long text around the match with ellipses", () => {
    const text = `${"filler words ".repeat(20)}the spare mantles are here ${"more filler ".repeat(20)}`;
    const out = snippetAround(text, "mantles", 60);
    expect(out).toContain("mantles");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(64);
  });
});
