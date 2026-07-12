// ---------------------------------------------------------------------------
// Garage layout — data-driven model of the physical garage.
//
// Position strings (A1…G5, LW<n>, RW<n>) are stable IDs stored in the
// database. Never rename them. The front wall (racks + workbench) is fixed
// physical geometry; the side walls are user-configurable shelf stacks —
// see buildWalls().
// ---------------------------------------------------------------------------

export const DEFAULT_LAYOUT = { leftShelves: 5, rightShelves: 5 };
export const MAX_SIDE_SHELVES = 12;

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

const FRONT_WALL = {
  id: "front",
  label: "Front wall",
  shortLabel: "Front",
  fixtures: [
    {
      id: "rack-ab",
      label: "Left rack",
      kind: "rack",
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
};

const range = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

/** Highest shelf index in use for a side-wall prefix ("LW"/"RW"). */
function highestOccupied(prefix, occupiedPositions) {
  let max = 0;
  occupiedPositions.forEach((pos) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(pos);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max;
}

/**
 * Build the three walls from the user's layout settings. A shelf that still
 * holds a tote is always rendered, even if the settings say fewer shelves —
 * changing a preference can never hide inventory.
 */
export function buildWalls(layout = DEFAULT_LAYOUT, occupiedPositions = []) {
  const leftCount = Math.max(
    1,
    layout.leftShelves ?? DEFAULT_LAYOUT.leftShelves,
    highestOccupied("LW", occupiedPositions)
  );
  const rightCount = Math.max(
    1,
    layout.rightShelves ?? DEFAULT_LAYOUT.rightShelves,
    highestOccupied("RW", occupiedPositions)
  );

  return [
    {
      id: "left",
      label: "Left wall",
      shortLabel: "Left",
      fixtures: [
        {
          id: "left-shelf",
          label: "Wall shelf",
          kind: "wallShelf",
          slots: range("LW", leftCount),
        },
      ],
    },
    FRONT_WALL,
    {
      id: "right",
      label: "Right wall",
      shortLabel: "Right",
      fixtures: [
        {
          id: "right-shelf",
          label: "Wall shelf",
          kind: "wallShelf",
          slots: range("RW", rightCount),
        },
      ],
    },
  ];
}

/** All slots across a set of walls. */
export function wallPositions(walls) {
  return walls.flatMap((wall) =>
    wall.fixtures.flatMap((f) => f.slots || (f.rows ? f.rows.flat().filter(Boolean) : []))
  );
}

// Static defaults — the rendered app uses buildWalls() with live settings,
// but validation and tests can rely on the default shape.
export const WALLS = buildWalls(DEFAULT_LAYOUT);
export const LEFT_WALL_POSITIONS = WALLS[0].fixtures[0].slots;
export const RIGHT_WALL_POSITIONS = WALLS[2].fixtures[0].slots;
export const SHELF_POSITIONS = wallPositions(WALLS);
export const TOTAL_POSITIONS = SHELF_POSITIONS.length;

const FRONT_INDEX = (() => {
  const index = {};
  FRONT_WALL.fixtures.forEach((fixture) => {
    fixture.rows.flat().filter(Boolean).forEach((pos) => {
      index[pos] = fixture;
    });
  });
  return index;
})();

/**
 * Wall id for a position, by pattern — works for any shelf number, not just
 * the currently configured count (older data must always resolve).
 */
export function getWallIdForPosition(position) {
  if (/^LW\d+$/.test(position)) return "left";
  if (/^RW\d+$/.test(position)) return "right";
  if (FRONT_INDEX[position]) return "front";
  return null;
}

/** Back-compat helper: the (default-shape) wall object for a position. */
export function getWallForPosition(position) {
  const id = getWallIdForPosition(position);
  return WALLS.find((w) => w.id === id) || null;
}

/**
 * Human-friendly location for a position, e.g.
 *   "A3"  → { wallId: "front", path: "Front wall · Left rack · Level 3" }
 *   "LW7" → { wallId: "left",  path: "Left wall · Shelf 7" }
 */
export function describePosition(position) {
  const wallId = getWallIdForPosition(position);
  if (!wallId) return { wallId: null, path: position };
  const level = parseInt(String(position).replace(/\D/g, ""), 10);
  if (wallId === "left") return { wallId, path: `Left wall · Shelf ${level}` };
  if (wallId === "right") return { wallId, path: `Right wall · Shelf ${level}` };
  const fixture = FRONT_INDEX[position];
  return { wallId, path: `Front wall · ${fixture.label} · Level ${level}` };
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
