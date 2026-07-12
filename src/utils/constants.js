// ---------------------------------------------------------------------------
// Garage layout — data-driven model of the physical garage.
//
// Position strings (A1…G5, LW1…LW5, RW1…RW5) are stable IDs stored in the
// database. Never rename them — add new fixtures/slots here instead.
// ---------------------------------------------------------------------------

export const LEFT_WALL_POSITIONS = ["LW1", "LW2", "LW3", "LW4", "LW5"];
export const RIGHT_WALL_POSITIONS = ["RW1", "RW2", "RW3", "RW4", "RW5"];

// Front-wall rack layout: columns A/B and F/G have 5 levels; C/D/E sit at
// floor level around the workbench (levels 4–5 only). null = no slot.
export const SHELF_LAYOUT = [
  ["A1", "B1", null, null, null, "F1", "G1"],
  ["A2", "B2", null, null, null, "F2", "G2"],
  ["A3", "B3", null, null, null, "F3", "G3"],
  ["A4", "B4", "C4", "D4", "E4", "F4", "G4"],
  ["A5", "B5", "C5", "D5", "E5", "F5", "G5"],
];

export const COLUMN_LABELS = ["A", "B", "C", "D", "E", "F", "G"];

// The three navigable garage walls. Each wall is a list of fixtures; each
// fixture renders as a physical structure (rack, workbench, wall shelf) and
// owns a set of slot positions. Dimensions/labels are configuration — adding
// a fixture (e.g. the top shelf) is a data change, not a UI rewrite.
export const WALLS = [
  {
    id: "left",
    label: "Left wall",
    shortLabel: "Left",
    fixtures: [
      {
        id: "left-shelf",
        label: "Wall shelf",
        kind: "wallShelf",
        slots: LEFT_WALL_POSITIONS,
      },
    ],
  },
  {
    id: "front",
    label: "Front wall",
    shortLabel: "Front",
    fixtures: [
      {
        id: "rack-ab",
        label: "Left rack",
        kind: "rack",
        // rows top → bottom; each row is a list of positions
        rows: [
          ["A1", "B1"],
          ["A2", "B2"],
          ["A3", "B3"],
          ["A4", "B4"],
          ["A5", "B5"],
        ],
      },
      {
        id: "workbench",
        label: "Workbench",
        kind: "workbench",
        rows: [
          ["C4", "D4", "E4"],
          ["C5", "D5", "E5"],
        ],
      },
      {
        id: "rack-fg",
        label: "Right rack",
        kind: "rack",
        rows: [
          ["F1", "G1"],
          ["F2", "G2"],
          ["F3", "G3"],
          ["F4", "G4"],
          ["F5", "G5"],
        ],
      },
    ],
  },
  {
    id: "right",
    label: "Right wall",
    shortLabel: "Right",
    fixtures: [
      {
        id: "right-shelf",
        label: "Wall shelf",
        kind: "wallShelf",
        slots: RIGHT_WALL_POSITIONS,
      },
    ],
  },
];

function fixtureSlots(fixture) {
  if (fixture.slots) return fixture.slots;
  if (fixture.rows) return fixture.rows.flat().filter(Boolean);
  return [];
}

// All valid positions, derived from the wall model so the two never drift.
export const SHELF_POSITIONS = WALLS.flatMap((wall) =>
  wall.fixtures.flatMap(fixtureSlots)
);

export const TOTAL_POSITIONS = SHELF_POSITIONS.length;

const POSITION_INDEX = (() => {
  const index = {};
  WALLS.forEach((wall) => {
    wall.fixtures.forEach((fixture) => {
      fixtureSlots(fixture).forEach((pos) => {
        index[pos] = { wall, fixture };
      });
    });
  });
  return index;
})();

/** The wall a position lives on, or null for unknown positions. */
export function getWallForPosition(position) {
  return POSITION_INDEX[position]?.wall || null;
}

/**
 * Human-friendly location for a position, e.g.
 *   "A3"  → { wallId: "front", path: "Front wall · Left rack · Level 3" }
 *   "LW2" → { wallId: "left",  path: "Left wall · Shelf 2" }
 */
export function describePosition(position) {
  const entry = POSITION_INDEX[position];
  if (!entry) return { wallId: null, path: position };
  const { wall, fixture } = entry;
  const level = parseInt(String(position).replace(/\D/g, ""), 10);
  const detail =
    fixture.kind === "wallShelf"
      ? `Shelf ${level}`
      : `${fixture.label} · Level ${level}`;
  return { wallId: wall.id, path: `${wall.label} · ${detail}` };
}

export const MAX_TOTE_NAME_LENGTH = 100;
export const MAX_ITEM_NAME_LENGTH = 100;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
