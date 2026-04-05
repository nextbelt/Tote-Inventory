export const SHELF_POSITIONS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "C4",
  "C5",
  "D4",
  "D5",
  "E4",
  "E5",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
];

// Grid layout: each row defines which positions exist.
// null = empty/disabled slot in the visual grid.
export const SHELF_LAYOUT = [
  ["A1", "B1", null, null, null, "F1", "G1"],
  ["A2", "B2", null, null, null, "F2", "G2"],
  ["A3", "B3", null, null, null, "F3", "G3"],
  ["A4", "B4", "C4", "D4", "E4", "F4", "G4"],
  ["A5", "B5", "C5", "D5", "E5", "F5", "G5"],
];

export const COLUMN_LABELS = ["A", "B", "C", "D", "E", "F", "G"];

export const MAX_TOTE_NAME_LENGTH = 100;
export const MAX_ITEM_NAME_LENGTH = 100;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
