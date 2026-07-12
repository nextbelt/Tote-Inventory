import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import Sheet from "./Sheet";
import { useToast } from "./Toast";
import { useTotes } from "../hooks/useTotes";
import {
  DEFAULT_LAYOUT,
  MAX_SIDE_COLUMNS,
  MAX_SIDE_SHELVES,
  parseSideSlot,
} from "../utils/constants";

const WALL_META = {
  left: {
    label: "Left wall",
    shelvesKey: "leftShelves",
    columnsKey: "leftColumns",
    prefix: "LW",
  },
  right: {
    label: "Right wall",
    shelvesKey: "rightShelves",
    columnsKey: "rightColumns",
    prefix: "RW",
  },
};

function Stepper({ label, hint, value, min, max, onChange, decLabel, incLabel }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
        {label}
      </div>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={decLabel}
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 disabled:opacity-30 dark:bg-gray-800 dark:text-gray-200"
        >
          <Minus className="h-6 w-6" aria-hidden="true" />
        </button>
        <div className="w-24 text-center">
          <div className="text-4xl font-bold text-gray-900 dark:text-gray-50">
            {value}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{hint}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={incLabel}
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 disabled:opacity-30 dark:bg-gray-800 dark:text-gray-200"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Build the side walls to match the real garage: how many shelf levels the
 * wall has, and how many totes sit side-by-side on each shelf. A slot that
 * still holds a tote can't be removed — move the tote first.
 */
export default function ShelfEditor({ wallId, onClose }) {
  const { layout, saveLayout, totesByPosition } = useTotes();
  const toast = useToast();
  const meta = WALL_META[wallId];

  // Lowest allowed counts = deepest shelf/column that still holds a tote
  const usage = useMemo(() => {
    let minShelves = 1;
    let shelfBlocker = null;
    let minColumns = 1;
    let columnBlocker = null;
    Object.entries(totesByPosition).forEach(([pos, tote]) => {
      const parsed = parseSideSlot(meta.prefix, pos);
      if (!parsed) return;
      if (parsed.shelf > minShelves) {
        minShelves = parsed.shelf;
        shelfBlocker = tote;
      }
      if (parsed.column > minColumns) {
        minColumns = parsed.column;
        columnBlocker = tote;
      }
    });
    return { minShelves, shelfBlocker, minColumns, columnBlocker };
  }, [totesByPosition, meta.prefix]);

  const currentShelves = Math.max(
    layout[meta.shelvesKey] ?? DEFAULT_LAYOUT[meta.shelvesKey],
    usage.minShelves
  );
  const currentColumns = Math.max(
    layout[meta.columnsKey] ?? DEFAULT_LAYOUT[meta.columnsKey],
    usage.minColumns
  );
  const [shelves, setShelves] = useState(currentShelves);
  const [columns, setColumns] = useState(currentColumns);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveLayout({
        ...layout,
        [meta.shelvesKey]: shelves,
        [meta.columnsKey]: columns,
      });
      toast.show(
        `${meta.label}: ${shelves} ${shelves === 1 ? "shelf" : "shelves"} · ${columns} tote${columns === 1 ? "" : "s"} per shelf`
      );
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={`Edit ${meta.label.toLowerCase()} shelves`} onClose={onClose}>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
        Match the app to your real wall. Totes keep their spots —{" "}
        {meta.prefix}1 is the top shelf; extra slots across get letters
        ({meta.prefix}1B, {meta.prefix}1C…).
      </p>

      <Stepper
        label="Shelves (up and down)"
        hint={shelves === 1 ? "shelf" : "shelves"}
        value={shelves}
        min={usage.minShelves}
        max={MAX_SIDE_SHELVES}
        onChange={setShelves}
        decLabel="Remove a shelf"
        incLabel="Add a shelf"
      />

      <Stepper
        label="Totes per shelf (across)"
        hint={columns === 1 ? "tote wide" : "totes wide"}
        value={columns}
        min={usage.minColumns}
        max={MAX_SIDE_COLUMNS}
        onChange={setColumns}
        decLabel="Remove a slot across"
        incLabel="Add a slot across"
      />

      {shelves <= usage.minShelves && usage.shelfBlocker && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Shelf {usage.minShelves} still holds “{usage.shelfBlocker.name}” —
          move it first to remove more shelves.
        </p>
      )}
      {columns <= usage.minColumns && usage.columnBlocker && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          A slot in column {usage.minColumns} still holds “
          {usage.columnBlocker.name}” — move it first to make shelves
          narrower.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={
          saving || (shelves === currentShelves && columns === currentColumns)
        }
        className="apple-button w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </Sheet>
  );
}
