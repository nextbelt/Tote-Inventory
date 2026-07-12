import { describe, expect, it } from "vitest";
import {
  validateImageFile,
  validateItemName,
  validatePosition,
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
