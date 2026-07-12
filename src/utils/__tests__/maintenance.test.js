import { describe, expect, it } from "vitest";
import {
  dataUriToBlob,
  embeddedPhotoBytes,
  findDuplicates,
  findEmbeddedPhotos,
  stripForCache,
} from "../maintenance";

const tote = (id, position, updated_at, items = []) => ({
  id,
  name: `Tote ${id}`,
  position,
  updated_at,
  items,
});

describe("findDuplicates", () => {
  it("returns empty when every position is unique", () => {
    expect(
      findDuplicates([tote(1, "A1", "2026-01-02"), tote(2, "B1", "2026-01-01")])
    ).toEqual([]);
  });

  it("keeps the newest row and lists older ones", () => {
    const groups = findDuplicates([
      tote(1, "A2", "2026-01-01"),
      tote(2, "A2", "2026-03-01"),
      tote(3, "A2", "2026-02-01"),
      tote(4, "B1", "2026-01-01"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].position).toBe("A2");
    expect(groups[0].keep.id).toBe(2);
    expect(groups[0].older.map((t) => t.id).sort()).toEqual([1, 3]);
  });

  it("never selects a hidden row for deletion that is the displayed one", () => {
    // the app displays max(updated_at) per position — keep must match that
    const rows = [
      tote(1, "F4", "2026-05-05"),
      tote(2, "F4", "2026-05-06"),
    ];
    const [group] = findDuplicates(rows);
    expect(group.keep.id).toBe(2);
    expect(group.older.every((t) => t.id !== 2)).toBe(true);
  });
});

describe("embedded photos", () => {
  const dataUri = `data:image/jpeg;base64,${"a".repeat(400)}`;
  const rows = [
    tote(1, "D4", "2026-01-01", [
      { id: "x", name: "Vase", image: dataUri },
      { id: "y", name: "Bowl", image: "https://cdn.example/bowl.jpg" },
    ]),
    tote(2, "A1", "2026-01-01", [{ id: "z", name: "Lights", image: null }]),
  ];

  it("finds only data-URI images", () => {
    const found = findEmbeddedPhotos(rows);
    expect(found).toHaveLength(1);
    expect(found[0].item.id).toBe("x");
    expect(found[0].tote.id).toBe(1);
  });

  it("estimates bytes from base64 length", () => {
    expect(embeddedPhotoBytes(rows)).toBeGreaterThan(200);
  });

  it("stripForCache nulls data-URIs but keeps URLs and other rows intact", () => {
    const stripped = stripForCache(rows);
    expect(stripped[0].items[0].image).toBeNull();
    expect(stripped[0].items[1].image).toBe("https://cdn.example/bowl.jpg");
    expect(stripped[1]).toBe(rows[1]); // untouched row is the same reference
    expect(rows[0].items[0].image).toBe(dataUri); // input not mutated
  });

  it("dataUriToBlob decodes mime and payload", () => {
    const blob = dataUriToBlob("data:image/png;base64,aGVsbG8=");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5); // "hello"
  });
});
