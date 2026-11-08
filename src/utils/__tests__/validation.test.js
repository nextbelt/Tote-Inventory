import { describe, expect, it } from "vitest";
import {
  normalizeNotes,
  normalizeTags,
  validateImageFile,
  validateItemName,
  validateNotes,
  validatePosition,
  validateTags,
  validateToteName,
} from "../validation";
import { MAX_IMAGE_SIZE_BYTES } from "../constants";

describe("validateToteName", () => {
  it("rejects an empty name", () => {
    expect(validateToteName("").valid).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(validateToteName("   ").valid).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    const result = validateToteName("a".repeat(101));
    expect(result.valid).toBe(false);
  });

  it("accepts a normal name", () => {
    expect(validateToteName("Camping Gear")).toEqual({
      valid: true,
      error: null,
    });
  });
});

describe("validateItemName", () => {
  it("rejects an empty name", () => {
    expect(validateItemName("").valid).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(validateItemName("   ").valid).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    const result = validateItemName("a".repeat(101));
    expect(result.valid).toBe(false);
  });

  it("accepts a normal name", () => {
    expect(validateItemName("Lantern")).toEqual({ valid: true, error: null });
  });
});

describe("validatePosition", () => {
  it("accepts a valid front-wall position", () => {
    expect(validatePosition("A1")).toEqual({ valid: true, error: null });
  });

  it("accepts a valid wall-shelf position", () => {
    expect(validatePosition("LW5")).toEqual({ valid: true, error: null });
  });

  it("rejects an unknown position", () => {
    expect(validatePosition("Z9").valid).toBe(false);
  });

  it("rejects an empty position", () => {
    expect(validatePosition("").valid).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("allows a missing file (images are optional)", () => {
    expect(validateImageFile(null)).toEqual({ valid: true, error: null });
  });

  it("rejects a disallowed file type", () => {
    const file = { type: "application/pdf", size: 1000 };
    expect(validateImageFile(file).valid).toBe(false);
  });

  it("rejects a file larger than 5 MB", () => {
    const file = { type: "image/png", size: MAX_IMAGE_SIZE_BYTES + 1 };
    expect(validateImageFile(file).valid).toBe(false);
  });

  it("accepts a valid image file", () => {
    const file = { type: "image/png", size: 1024 };
    expect(validateImageFile(file)).toEqual({ valid: true, error: null });
  });
});

describe("tags", () => {
  it("normalizeTags trims, collapses whitespace, drops empties and dedupes case-insensitively", () => {
    expect(normalizeTags(["  Holiday  Lights ", "holiday lights", "", "  ", "Camping", 3, null])).toEqual([
      "Holiday Lights",
      "Camping",
    ]);
  });

  it("normalizeTags keeps the first spelling and accepts a comma-separated string", () => {
    expect(normalizeTags("camping, Camping ,CAMPING,tools")).toEqual(["camping", "tools"]);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it("validateTags enforces 24 chars each and 10 per tote", () => {
    expect(validateTags(["a".repeat(24)]).valid).toBe(true);
    expect(validateTags(["a".repeat(25)]).valid).toBe(false);
    expect(validateTags(Array.from({ length: 10 }, (_, i) => `t${i}`)).valid).toBe(true);
    expect(validateTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).valid).toBe(false);
    expect(validateTags("nope").valid).toBe(false);
    expect(validateTags([]).valid).toBe(true);
  });
});

describe("notes", () => {
  it("normalizeNotes trims, normalizes line endings and turns empty into null", () => {
    expect(normalizeNotes("  lid cracked\r\nhandle loose  ")).toBe("lid cracked\nhandle loose");
    expect(normalizeNotes("   ")).toBeNull();
    expect(normalizeNotes("")).toBeNull();
    expect(normalizeNotes(null)).toBeNull();
    expect(normalizeNotes(undefined)).toBeNull();
  });

  it("validateNotes allows null and up to 500 characters", () => {
    expect(validateNotes(null).valid).toBe(true);
    expect(validateNotes("x".repeat(500)).valid).toBe(true);
    expect(validateNotes("x".repeat(501)).valid).toBe(false);
    expect(validateNotes(42).valid).toBe(false);
  });
});
