import {
  Camera,
  ChevronLeft,
  Edit2,
  MapPin,
  Minus,
  MoveRight,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../components/Toast";
import { useTotes } from "../hooks/useTotes";
import { describePosition, WALLS } from "../utils/constants";
import { compressImage } from "../utils/images";
import { toteService } from "../services/toteService";
import { validateImageFile, validateItemName } from "../utils/validation";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const itemQty = (item) => {
  const q = Number(item?.qty);
  return Number.isFinite(q) && q >= 0 ? q : 1;
};

/** All slots on a wall in natural reading order (A1, A2 … B1, B2 …). */
function wallSlots(wall) {
  return wall.fixtures
    .flatMap((f) => f.slots || (f.rows ? f.rows.flat() : []))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Bottom sheet scaffold: scrollable, safe-area aware, Esc/backdrop close. */
function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="apple-subtitle text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function DetailPage({
  tote: initialTote,
  onBack,
  onEdit,
  onDeleted,
  onShowInGarage,
}) {
  const { totes, totesByPosition, saveTote, deleteTote, moveTote, restoreTote } =
    useTotes();
  const toast = useToast();

  // Always read the latest version from the store
  const tote = totes.find((t) => t.id === initialTote.id) || initialTote;
  const storeItems = Array.isArray(tote.items) ? tote.items : [];

  // Optimistic item edits: pendingItems shows instantly, then persists
  const [pendingItems, setPendingItems] = useState(null);
  const items = pendingItems ?? storeItems;

  const [newItemName, setNewItemName] = useState("");
  const [newItemImage, setNewItemImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState(null); // "move" | "delete" | null
  const [lightbox, setLightbox] = useState(null);

  const saveTimerRef = useRef(null);
  const latestRef = useRef({ tote, items: null });
  latestRef.current.tote = tote;

  const persistItems = useCallback(
    async (nextItems) => {
      clearTimeout(saveTimerRef.current);
      latestRef.current.items = null;
      try {
        await saveTote({ ...latestRef.current.tote, items: nextItems }, false);
        setPendingItems(null);
      } catch (err) {
        setPendingItems(null); // fall back to the store's truth
        toast.error(err.message);
      }
    },
    [saveTote, toast]
  );

  /** Show instantly, save soon (coalesces rapid +/- taps). */
  const stageItems = useCallback(
    (nextItems, { immediate = false } = {}) => {
      setPendingItems(nextItems);
      latestRef.current.items = nextItems;
      clearTimeout(saveTimerRef.current);
      if (immediate) {
        return persistItems(nextItems);
      } else {
        saveTimerRef.current = setTimeout(
          () => persistItems(latestRef.current.items ?? nextItems),
          700
        );
      }
    },
    [persistItems]
  );

  // Flush any pending quantity edits when leaving the page
  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current);
      const { tote: t, items: staged } = latestRef.current;
      if (staged) {
        toteService.saveTote({ ...t, items: staged }, false).catch(() => {});
      }
    },
    []
  );

  // ------ quick add ------
  const handlePhotoPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const url = await toteService.uploadImage(
        compressed,
        `${Date.now()}-${compressed.name}`
      );
      setNewItemImage(url);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleAddItem = async () => {
    const check = validateItemName(newItemName);
    if (!check.valid) return;
    setAdding(true);
    const next = [
      ...items,
      { id: newId(), name: newItemName.trim(), image: newItemImage, qty: 1 },
    ];
    setNewItemName("");
    setNewItemImage(null);
    await stageItems(next, { immediate: true });
    setAdding(false);
  };

  // ------ quantity / remove ------
  const changeQty = (item, delta) => {
    const next = items.map((it) =>
      it.id === item.id ? { ...it, qty: Math.max(0, itemQty(it) + delta) } : it
    );
    stageItems(next);
  };

  const removeItem = (item) => {
    const snapshot = items;
    stageItems(
      items.filter((it) => it.id !== item.id),
      { immediate: true }
    );
    toast.show(`Removed “${item.name}”`, {
      actionLabel: "Undo",
      onAction: () => stageItems(snapshot, { immediate: true }),
    });
  };

  // ------ move / delete ------
  const handleMove = async (position) => {
    const from = tote.position;
    setSheet(null);
    try {
      await moveTote(tote, position);
      const { path } = describePosition(position);
      toast.show(`Moved to ${path}`, {
        actionLabel: "Undo",
        onAction: () =>
          moveTote({ ...tote, position }, from).catch((err) =>
            toast.error(err.message)
          ),
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    const snapshot = { name: tote.name, position: tote.position, items };
    setSheet(null);
    try {
      await deleteTote(tote.id);
      onDeleted();
      toast.show(`Deleted “${snapshot.name}”`, {
        actionLabel: "Undo",
        onAction: () =>
          restoreTote(snapshot).catch((err) => toast.error(err.message)),
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const { path } = describePosition(tote.position);
  const totalThings = items.reduce((sum, it) => sum + itemQty(it), 0);

  return (
    <div
      className="min-h-dvh"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
    >
      {/* Sticky header */}
      <header
        className="sticky top-0 z-30 border-b border-white/40 bg-white/80 backdrop-blur-xl"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-[44px] items-center gap-1 rounded-xl px-2 font-medium text-blue-600"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Garage
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSheet("move")}
              className="flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-semibold text-blue-600"
            >
              <MoveRight className="h-4 w-4" aria-hidden="true" />
              Move
            </button>
            <button
              type="button"
              onClick={() => onEdit(tote)}
              aria-label="Rename tote"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-blue-600"
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setSheet("delete")}
              aria-label="Delete tote"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-red-500"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4">
        <h1 className="apple-title mb-2 text-2xl sm:text-3xl">{tote.name}</h1>
        <button
          type="button"
          onClick={() => onShowInGarage(tote.position)}
          className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {path}
          <span className="font-normal text-blue-500">· Show me</span>
        </button>

        {/* Quick add */}
        <div className="apple-card mb-5 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
              }}
              placeholder="Add an item…"
              maxLength={100}
              autoComplete="off"
              autoCapitalize="sentences"
              className="apple-input min-w-0 flex-1"
            />
            <label
              className={`flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed ${
                newItemImage
                  ? "border-green-400 bg-green-50 text-green-600"
                  : "border-gray-300 text-gray-400"
              } ${uploading ? "animate-pulse" : ""}`}
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">
                {newItemImage ? "Change photo" : "Add photo"}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoPick}
                className="hidden"
                disabled={uploading}
              />
            </label>
            <button
              type="button"
              onClick={handleAddItem}
              disabled={!newItemName.trim() || uploading || adding}
              className="apple-button flex h-12 w-12 shrink-0 items-center justify-center !p-0 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Add item"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {newItemImage && (
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
              <img
                src={newItemImage}
                alt="New item preview"
                className="h-12 w-12 rounded-lg border border-gray-200 object-cover"
              />
              Photo attached
              <button
                type="button"
                onClick={() => setNewItemImage(null)}
                className="min-h-[44px] px-2 font-semibold text-red-500"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {/* Items */}
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="apple-subtitle text-lg">
            Items ({items.length})
          </h2>
          {totalThings !== items.length && (
            <span className="text-sm text-gray-500">
              {totalThings} things total
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="apple-card p-8 text-center text-gray-500">
            Nothing in this tote yet — add the first item above.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const qty = itemQty(item);
              const out = qty === 0;
              return (
                <li
                  key={item.id}
                  className="apple-card flex items-center gap-3 p-2.5"
                >
                  {item.image ? (
                    <button
                      type="button"
                      onClick={() => setLightbox(item)}
                      aria-label={`View photo of ${item.name}`}
                      className="shrink-0"
                    >
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                        className="h-14 w-14 rounded-lg border border-gray-200 object-cover"
                      />
                    </button>
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300">
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`line-clamp-2 break-words font-semibold leading-snug ${
                        out ? "text-gray-400 line-through" : "text-gray-900"
                      }`}
                    >
                      {item.name}
                    </p>
                    {out && (
                      <span className="text-xs font-semibold text-red-500">
                        Out — restock?
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-gray-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => changeQty(item, -1)}
                      disabled={qty === 0}
                      aria-label={`Use one ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 disabled:opacity-30"
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span
                      className="w-7 text-center text-sm font-bold text-gray-900"
                      aria-label={`Quantity: ${qty}`}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeQty(item, 1)}
                      aria-label={`Add one ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-700"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    aria-label={`Remove ${item.name}`}
                    className="flex h-11 w-9 items-center justify-center rounded-lg text-gray-400"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* Move sheet */}
      {sheet === "move" && (
        <Sheet title={`Move “${tote.name}”`} onClose={() => setSheet(null)}>
          <p className="mb-3 text-sm text-gray-500">
            Pick an empty spot. It&apos;s now in {path}.
          </p>
          {WALLS.map((wall) => (
            <div key={wall.id} className="mb-4">
              <h3 className="mb-1.5 text-sm font-bold text-gray-700">
                {wall.label}
              </h3>
              <div className="grid grid-cols-5 gap-1.5">
                {wallSlots(wall).map((pos) => {
                  const occupant = totesByPosition[pos];
                  const isHere = pos === tote.position;
                  return (
                    <button
                      key={pos}
                      type="button"
                      disabled={Boolean(occupant)}
                      onClick={() => handleMove(pos)}
                      className={`min-h-[48px] rounded-xl border text-xs font-bold ${
                        isHere
                          ? "border-blue-500 bg-blue-500 text-white"
                          : occupant
                          ? "border-gray-200 bg-gray-100 text-gray-400"
                          : "border-blue-200 bg-white text-blue-700 active:bg-blue-50"
                      }`}
                    >
                      {pos}
                      {isHere && (
                        <span className="block text-[10px] font-normal">
                          here
                        </span>
                      )}
                      {occupant && !isHere && (
                        <span className="block truncate px-0.5 text-[10px] font-normal">
                          {occupant.name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Sheet>
      )}

      {/* Delete sheet */}
      {sheet === "delete" && (
        <Sheet title="Delete this tote?" onClose={() => setSheet(null)}>
          <p className="mb-4 text-gray-600">
            “{tote.name}” and its {items.length} item
            {items.length === 1 ? "" : "s"} will be removed. You&apos;ll get a
            few seconds to undo.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSheet(null)}
              className="min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="min-h-[48px] flex-1 rounded-xl bg-red-500 font-semibold text-white"
            >
              Delete
            </button>
          </div>
        </Sheet>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo of ${lightbox.name}`}
        >
          <button
            type="button"
            aria-label="Close photo"
            onClick={() => setLightbox(null)}
            className="absolute inset-0"
          />
          <img
            src={lightbox.image}
            alt={lightbox.name}
            className="pointer-events-none relative max-h-[80dvh] max-w-full rounded-2xl"
          />
          <p className="pointer-events-none absolute bottom-8 left-0 right-0 text-center font-semibold text-white">
            {lightbox.name}
          </p>
        </div>
      )}
    </div>
  );
}
