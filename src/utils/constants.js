// Wall positions for overflow totes not on the rack
export const LEFT_WALL_POSITIONS = ["LW1", "LW2", "LW3", "LW4", "LW5"];
export const RIGHT_WALL_POSITIONS = ["RW1", "RW2", "RW3", "RW4", "RW5"];

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
  ...LEFT_WALL_POSITIONS,
  ...RIGHT_WALL_POSITIONS,
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
