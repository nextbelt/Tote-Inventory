// ---------------------------------------------------------------------------
// Garage layout — data-driven model of the physical garage.
//
// Position strings (A1…G5, LW<n>, RW<n>) are stable IDs stored in the
// database. Never rename them. The front wall (racks + workbench) is fixed
// physical geometry; the side walls are user-configurable shelf stacks —
// see buildWalls().
// ---------------------------------------------------------------------------

export const DEFAULT_LAYOUT = {
  leftShelves: 5,
  leftColumns: 1,
  rightShelves: 5,
  rightColumns: 1,
};
export const MAX_SIDE_SHELVES = 12;
export const MAX_SIDE_COLUMNS = 4;

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

// Side-wall slot IDs: column 1 keeps the legacy ID ("LW3"); extra columns
// get a letter suffix ("LW3B" = shelf 3, second slot across).
export function sideSlotId(prefix, shelf, column) {
  return column === 1
    ? `${prefix}${shelf}`
    : `${prefix}${shelf}${String.fromCharCode(64 + column)}`;
}

/** Parse a side-wall slot: "LW3B" → { shelf: 3, column: 2 }, else null. */
export function parseSideSlot(prefix, position) {
  const m = new RegExp(`^${prefix}(\\d+)([B-Z])?$`).exec(position);
  if (!m) return null;
  return {
    shelf: parseInt(m[1], 10),
    column: m[2] ? m[2].charCodeAt(0) - 64 : 1,
  };
}

/** Highest shelf/column in use for a side-wall prefix ("LW"/"RW"). */
function sideUsage(prefix, occupiedPositions) {
  let shelves = 0;
  let columns = 1;
  occupiedPositions.forEach((pos) => {
    const parsed = parseSideSlot(prefix, pos);
    if (parsed) {
      shelves = Math.max(shelves, parsed.shelf);
      columns = Math.max(columns, parsed.column);
    }
  });
  return { shelves, columns };
}

function sideWallFixture(id, prefix, layout, layoutKeys, occupiedPositions) {
  const used = sideUsage(prefix, occupiedPositions);
  const shelves = Math.max(
    1,
    layout[layoutKeys.shelves] ?? DEFAULT_LAYOUT[layoutKeys.shelves],
    used.shelves
  );
  const columns = Math.max(
    1,
    layout[layoutKeys.columns] ?? DEFAULT_LAYOUT[layoutKeys.columns],
    used.columns
  );
  const rows = [];
  for (let s = 1; s <= shelves; s++) {
    const row = [];
    for (let c = 1; c <= columns; c++) row.push(sideSlotId(prefix, s, c));
    rows.push(row);
  }
  return { id, label: "Wall shelf", kind: "wallShelf", rows };
}

/**
 * Build the three walls from the user's layout settings (shelf levels and
 * totes-per-shelf columns for each side wall). A slot that still holds a
 * tote is always rendered, even if the settings shrink — changing a
 * preference can never hide inventory.
 */
export function buildWalls(layout = DEFAULT_LAYOUT, occupiedPositions = []) {
  return [
    {
      id: "left",
      label: "Left wall",
      shortLabel: "Left",
      fixtures: [
        sideWallFixture(
          "left-shelf",
          "LW",
          layout,
          { shelves: "leftShelves", columns: "leftColumns" },
          occupiedPositions
        ),
      ],
    },
    FRONT_WALL,
    {
      id: "right",
      label: "Right wall",
      shortLabel: "Right",
      fixtures: [
        sideWallFixture(
          "right-shelf",
          "RW",
          layout,
          { shelves: "rightShelves", columns: "rightColumns" },
          occupiedPositions
        ),
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
export const LEFT_WALL_POSITIONS = WALLS[0].fixtures[0].rows.flat();
export const RIGHT_WALL_POSITIONS = WALLS[2].fixtures[0].rows.flat();
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
 * Wall id for a position, by pattern — works for any shelf/column, not just
 * the currently configured counts (older data must always resolve).
 */
export function getWallIdForPosition(position) {
  if (parseSideSlot("LW", position)) return "left";
  if (parseSideSlot("RW", position)) return "right";
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
 *   "A3"   → { wallId: "front", path: "Front wall · Left rack · Level 3" }
 *   "LW7"  → { wallId: "left",  path: "Left wall · Shelf 7" }
 *   "RW2C" → { wallId: "right", path: "Right wall · Shelf 2 · Slot C" }
 */
export function describePosition(position) {
  const side = (prefix, label) => {
    const parsed = parseSideSlot(prefix, position);
    if (!parsed) return null;
    const slot =
      parsed.column > 1
        ? ` · Slot ${String.fromCharCode(64 + parsed.column)}`
        : "";
    return `${label} · Shelf ${parsed.shelf}${slot}`;
  };

  const left = side("LW", "Left wall");
  if (left) return { wallId: "left", path: left };
  const right = side("RW", "Right wall");
  if (right) return { wallId: "right", path: right };

  const fixture = FRONT_INDEX[position];
  if (!fixture) return { wallId: null, path: position };
  const level = parseInt(String(position).replace(/\D/g, ""), 10);
  return {
    wallId: "front",
    path: `Front wall · ${fixture.label} · Level ${level}`,
  };
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
