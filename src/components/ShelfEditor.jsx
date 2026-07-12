import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import Sheet from "./Sheet";
import { useToast } from "./Toast";
import { useTotes } from "../hooks/useTotes";
import { DEFAULT_LAYOUT, MAX_SIDE_SHELVES } from "../utils/constants";

const WALL_META = {
  left: { label: "Left wall", key: "leftShelves", prefix: "LW" },
  right: { label: "Right wall", key: "rightShelves", prefix: "RW" },
};

/**
 * Build the side walls to match the real garage: choose how many shelves
 * each wall has. A shelf that still holds a tote can't be removed — move
 * the tote first.
 */
export default function ShelfEditor({ wallId, onClose }) {
  const { layout, saveLayout, totesByPosition } = useTotes();
  const toast = useToast();
  const meta = WALL_META[wallId];

  // Lowest allowed count = highest shelf that still holds a tote
  const { minCount, blocker } = useMemo(() => {
    let min = 1;
    let holder = null;
    Object.keys(totesByPosition).forEach((pos) => {
      const m = new RegExp(`^${meta.prefix}(\\d+)$`).exec(pos);
      if (m) {
        const level = parseInt(m[1], 10);
        if (level > min) {
          min = level;
          holder = totesByPosition[pos];
        }
      }
    });
    return { minCount: min, blocker: holder };
  }, [totesByPosition, meta.prefix]);

  const current = Math.max(
    layout[meta.key] ?? DEFAULT_LAYOUT[meta.key],
    minCount
  );
  const [count, setCount] = useState(current);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveLayout({ ...layout, [meta.key]: count });
      toast.show(
        `${meta.label} now has ${count} ${count === 1 ? "shelf" : "shelves"}`
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
        Match the app to your real wall — choose how many shelf levels it has.
        Totes keep their spots ({meta.prefix}1 is the top shelf).
      </p>

      <div className="mb-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setCount((c) => Math.max(minCount, c - 1))}
          disabled={count <= minCount}
          aria-label="Remove a shelf"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 disabled:opacity-30 dark:bg-gray-800 dark:text-gray-200"
        >
          <Minus className="h-6 w-6" aria-hidden="true" />
        </button>
        <div className="w-28 text-center">
          <div className="text-4xl font-bold text-gray-900 dark:text-gray-50">
            {count}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {count === 1 ? "shelf" : "shelves"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCount((c) => Math.min(MAX_SIDE_SHELVES, c + 1))}
          disabled={count >= MAX_SIDE_SHELVES}
          aria-label="Add a shelf"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 disabled:opacity-30 dark:bg-gray-800 dark:text-gray-200"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      {count <= minCount && blocker && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Shelf {minCount} still holds “{blocker.name}” — move it first to
          remove more shelves.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || count === current}
        className="apple-button w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </Sheet>
  );
}
