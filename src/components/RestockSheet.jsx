import { Package, Plus } from "lucide-react";
import { useMemo } from "react";
import Sheet from "./Sheet";
import { useToast } from "./Toast";
import { useTotes } from "../hooks/useTotes";
import { describePosition } from "../utils/constants";
import { restockItems } from "../utils/insights";
import { adjustQty } from "../utils/itemOps";

/** Every item at quantity 0 across the visible totes, grouped by tote. */
export default function RestockSheet({ onClose, onSelectTote }) {
  const { totesByPosition, updateItems } = useTotes();
  const toast = useToast();

  const groups = useMemo(() => {
    const list = [];
    restockItems(Object.values(totesByPosition)).forEach(({ tote, item }) => {
      const last = list[list.length - 1];
      if (last && last.tote.id === tote.id) last.items.push(item);
      else list.push({ tote, items: [item] });
    });
    return list;
  }, [totesByPosition]);

  const gotOne = async (tote, item) => {
    try {
      await updateItems(tote.id, adjustQty(item.id, 1));
      toast.show(`Restocked “${item.name}”`, {
        actionLabel: "Undo",
        onAction: () =>
          updateItems(tote.id, adjustQty(item.id, -1)).catch((err) =>
            toast.error(err.message)
          ),
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Sheet title="Restock" onClose={onClose}>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-gray-500 dark:text-gray-400">
          Nothing to restock — no item is at quantity 0.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ tote, items }) => (
            <section key={tote.id} aria-label={`${tote.name} restock items`}>
              <h3 className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {tote.name}
              </h3>
              <p className="mb-1.5 px-1 text-xs text-gray-500 dark:text-gray-400">
                {describePosition(tote.position).path}
              </p>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={`${tote.id}-${item.id}`}
                    className="apple-card overflow-hidden"
                  >
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onSelectTote(tote, { itemId: item.id })}
                        aria-label={`Open ${tote.name}: ${item.name}`}
                        className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 p-3 text-left"
                      >
                        {item.image ? (
                          <img
                            src={item.image}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                          />
                        ) : (
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                            <Package
                              className="h-6 w-6 text-gray-400 dark:text-gray-500"
                              aria-hidden="true"
                            />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">
                          {item.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => gotOne(tote, item)}
                        aria-label={`Got one: ${item.name}`}
                        className="mr-2 flex min-h-[48px] shrink-0 items-center gap-1 rounded-xl bg-blue-50 px-3 text-sm font-semibold text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Got one
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
