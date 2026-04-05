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

export function validatePosition(position) {
  if (!position) {
    return { valid: false, error: "Position is required." };
  }
  if (!SHELF_POSITIONS.includes(position)) {
    return { valid: false, error: "Invalid shelf position." };
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
