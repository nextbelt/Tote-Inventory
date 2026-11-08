import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_ITEM_NAME_LENGTH,
  MAX_TOTE_NAME_LENGTH,
  SHELF_POSITIONS,
} from "./constants";

export function validateToteName(name) {
  if (!name || !name.trim()) {
    return { valid: false, error: "Tote name is required." };
  }
  if (name.trim().length > MAX_TOTE_NAME_LENGTH) {
    return {
      valid: false,
      error: `Tote name must be ${MAX_TOTE_NAME_LENGTH} characters or less.`,
    };
  }
  return { valid: true, error: null };
}

export function validateItemName(name) {
  if (!name || !name.trim()) {
    return { valid: false, error: "Item name is required." };
  }
  if (name.trim().length > MAX_ITEM_NAME_LENGTH) {
    return {
      valid: false,
      error: `Item name must be ${MAX_ITEM_NAME_LENGTH} characters or less.`,
    };
  }
  return { valid: true, error: null };
}

// A short note on one item ("left shoe only", "needs batteries"). Lives in
// the items JSONB, so no database change is involved.
export const MAX_ITEM_NOTE_LENGTH = 200;

/** Optional: empty / null / undefined are fine (the note is removed). */
export function validateItemNote(note) {
  if (note === null || note === undefined || note === "") {
    return { valid: true, error: null };
  }
  if (typeof note !== "string") {
    return { valid: false, error: "Note must be text." };
  }
  if (note.trim().length > MAX_ITEM_NOTE_LENGTH) {
    return {
      valid: false,
      error: `Note must be ${MAX_ITEM_NOTE_LENGTH} characters or less.`,
    };
  }
  return { valid: true, error: null };
}

export function validatePosition(position) {
  if (!position) {
    return { valid: false, error: "Position is required." };
  }
  if (!SHELF_POSITIONS.includes(position)) {
    return { valid: false, error: "Invalid shelf position." };
  }
  return { valid: true, error: null };
}

// ---------------------------------------------------------------------------
// Tote tags and notes (columns added by supabase/migrations/20261108_…sql)
// ---------------------------------------------------------------------------

export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS_PER_TOTE = 10;
export const MAX_NOTES_LENGTH = 500;

/**
 * Normalize tags: trim, collapse inner whitespace, drop empties, dedupe
 * case-insensitively keeping the first spelling. Accepts an array or a
 * comma-separated string. Never throws — validate the result with
 * validateTags() for length/count limits.
 */
export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set();
  const out = [];
  raw.forEach((value) => {
    if (typeof value !== "string") return;
    const tag = value.trim().replace(/\s+/g, " ");
    if (!tag) return;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  });
  return out;
}

export function validateTags(tags) {
  if (!Array.isArray(tags)) {
    return { valid: false, error: "Tags must be a list." };
  }
  if (tags.length > MAX_TAGS_PER_TOTE) {
    return {
      valid: false,
      error: `A tote can have up to ${MAX_TAGS_PER_TOTE} tags.`,
    };
  }
  const bad = tags.find(
    (t) => typeof t !== "string" || !t.trim() || t.length > MAX_TAG_LENGTH
  );
  if (bad !== undefined) {
    return {
      valid: false,
      error: `Each tag must be 1 to ${MAX_TAG_LENGTH} characters.`,
    };
  }
  return { valid: true, error: null };
}

/** Trim notes (line endings normalized); empty → null. Never throws. */
export function normalizeNotes(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).replace(/\r\n?/g, "\n").trim();
  return text ? text : null;
}

export function validateNotes(notes) {
  if (notes === null || notes === undefined) return { valid: true, error: null };
  if (typeof notes !== "string") {
    return { valid: false, error: "Notes must be text." };
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      valid: false,
      error: `Notes must be ${MAX_NOTES_LENGTH} characters or less.`,
    };
  }
  return { valid: true, error: null };
}

export function validateImageFile(file) {
  if (!file) {
    return { valid: true, error: null }; // images are optional
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Only JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: "Image must be 5 MB or smaller." };
  }
  return { valid: true, error: null };
}
