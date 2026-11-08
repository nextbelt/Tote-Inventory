import {
  Camera,
  ChevronLeft,
  Clock,
  Edit2,
  MapPin,
  Minus,
  MoveRight,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sheet from "../components/Sheet";
import { useToast } from "../components/Toast";
import { useTotes } from "../hooks/useTotes";
import { describePosition } from "../utils/constants";
import { compressImage } from "../utils/images";
import RelativeTime from "../components/RelativeTime";
import { formatDateTime, toteModifiedDate } from "../utils/time";
import { toteService } from "../services/toteService";
import {
  addItem,
  adjustQty,
  composeOps,
  itemQty,
  removeItem as removeItemOp,
  restoreItem,
} from "../utils/itemOps";
import { validateImageFile, validateItemName } from "../utils/validation";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const EMPTY_ITEMS = [];
const QTY_FLUSH_MS = 700;

/** Coalesced +/- taps (Map itemId → delta) as one item operation. */
const deltasToOp = (deltas) =>
  composeOps(...[...deltas].map(([id, delta]) => adjustQty(id, delta)));

/** All slots on a wall in natural reading order (A1, A2 … B1, B2 …). */
function wallSlots(wall) {
  return wall.fixtures
    .flatMap((f) => f.slots || (f.rows ? f.rows.flat() : []))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export default function DetailPage({
  tote: initialTote,
  onBack,
  onEdit,
  onDeleted,
  onShowInGarage,
}) {
  const {
    totes,
    totesByPosition,
    walls,
    updateItems,
    deleteTote,
    moveTote,
    restoreTote,
  } = useTotes();
  const toast = useToast();

  // Always read the latest version from the store
  const tote = totes.find((t) => t.id === initialTote.id) || initialTote;
  const storeItems = Array.isArray(tote.items) ? tote.items : EMPTY_ITEMS;

  // Optimistic edits are OPERATIONS layered on the live store, never a
  // snapshot. So a realtime refresh from the other phone can't wipe what is
  // staged here, and what is staged here lands on top of their changes.
  //   staged   – +/- taps coalesced per item id, saved after a short pause
  //   inflight – ops being saved right now (add / remove / undo / flushed +/-)
  const [staged, setStaged] = useState(() => new Map());
  const [inflight, setInflight] = useState([]);
  const stagedRef = useRef(staged);
  const saveTimerRef = useRef(null);
  const toteRef = useRef(tote);
  toteRef.current = tote;

  const items = useMemo(
    () =>
      composeOps(
        ...inflight.map((op) => op.apply),
        deltasToOp(staged)
      )(storeItems),
    [storeItems, inflight, staged]
  );

  const [newItemName, setNewItemName] = useState("");
  const [newItemImage, setNewItemImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState(null); // "move" | "delete" | null
  const [lightbox, setLightbox] = useState(null);

  const replaceStaged = useCallback((next) => {
    stagedRef.current = next;
    setStaged(next);
  }, []);

  /** Save one item operation; it stays visible while in flight. */
  const runOp = useCallback(
    async (apply) => {
      const key = newId();
      setInflight((prev) => [...prev, { key, apply }]);
      try {
        await updateItems(toteRef.current.id, apply);
      } catch (err) {
        toast.error(err.message);
      } finally {
        // The store already holds the saved row by now, so dropping the
        // overlay is seamless (both updates land in the same React batch).
        setInflight((prev) => prev.filter((op) => op.key !== key));
      }
    },
    [updateItems, toast]
  );

  /** Persist the coalesced +/- taps now (no-op when nothing is staged). */
  const flushStaged = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    const deltas = stagedRef.current;
    if (deltas.size === 0) return Promise.resolve();
    replaceStaged(new Map());
    return runOp(deltasToOp(deltas));
  }, [replaceStaged, runOp]);

  // Flush any staged quantity edits when leaving the page — through the
  // same op path (and the shared store, so the grid and a re-opened detail
  // page already show the saved quantity).
  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current);
      const deltas = stagedRef.current;
      if (deltas.size === 0) return;
      stagedRef.current = new Map();
      const t = toteRef.current;
      updateItems(t.id, deltasToOp(deltas)).catch(() => {
        // ToastProvider outlives this page, so the user still hears about it
        toast.error(
          `Your last change to “${t.name}” didn't save. Please check it.`
        );
      });
    },
    [toast, updateItems]
  );

  // A Home Screen app on iPhone doesn't unmount when the phone locks or the
  // app is swiped away — so land staged +/- taps the moment the page hides
  // instead of waiting out the debounce (which may never run).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushStaged();
    };
    const onPageHide = () => flushStaged();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushStaged]);

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
    const item = {
      id: newId(),
      name: newItemName.trim(),
      image: newItemImage,
      qty: 1,
    };
    setNewItemName("");
    setNewItemImage(null);
    await runOp(addItem(item));
    setAdding(false);
  };

  // ------ quantity / remove ------
  /** Show instantly; the net delta per item is saved after a short pause. */
  const changeQty = (item, delta) => {
    const next = new Map(stagedRef.current);
    const total = (next.get(item.id) || 0) + delta;
    if (total === 0) next.delete(item.id);
    else next.set(item.id, total);
    replaceStaged(next);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushStaged, QTY_FLUSH_MS);
  };

  const removeItem = (item) => {
    const index = items.findIndex((it) => it.id === item.id);
    // Land any staged +/- first so Undo brings back the quantity you saw
    flushStaged();
    runOp(removeItemOp(item.id));
    toast.show(`Removed “${item.name}”`, {
      actionLabel: "Undo",
      // Restore-by-id: safe even if the other phone changed the list since
      onAction: () => runOp(restoreItem(item, index)),
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
        // Position-only patch: undoing a move can't revert item edits
        onAction: () =>
          moveTote(tote, from).catch((err) => toast.error(err.message)),
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    const snapshot = { name: tote.name, position: tote.position, items };
    setSheet(null);
    // The snapshot already carries any staged +/- taps. Hold them while the
    // delete is in flight so the debounce can't fire a save at a tote that
    // is disappearing (which would show a bogus "couldn't find" error).
    clearTimeout(saveTimerRef.current);
    try {
      await deleteTote(tote.id);
      // …and never let the unmount flush try to save them afterwards.
      replaceStaged(new Map());
      onDeleted();
      toast.show(`Deleted “${snapshot.name}”`, {
        actionLabel: "Undo",
        onAction: () =>
          restoreTote(snapshot).catch((err) => toast.error(err.message)),
      });
    } catch (err) {
      toast.error(err.message);
      // Delete failed, so the tote is still here — save the held taps
      if (stagedRef.current.size > 0) {
        saveTimerRef.current = setTimeout(flushStaged, QTY_FLUSH_MS);
      }
    }
  };

  const { path } = describePosition(tote.position);
  const modified = toteModifiedDate(tote);
  const totalThings = items.reduce((sum, it) => sum + itemQty(it), 0);

  return (
    <div
      className="min-h-[100dvh]"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
    >
      {/* Sticky header */}
      <header
        className="sticky top-0 z-30 border-b border-white/40 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-[44px] items-center gap-1 rounded-xl px-2 font-medium text-blue-600 dark:text-blue-400"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Garage
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSheet("move")}
              className="flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-semibold text-blue-600 dark:text-blue-400"
            >
              <MoveRight className="h-4 w-4" aria-hidden="true" />
              Move
            </button>
            <button
              type="button"
              onClick={() => onEdit(tote)}
              aria-label="Rename tote"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-blue-600 dark:text-blue-400"
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
        <h1 className="apple-title mb-1 text-2xl sm:text-3xl">{tote.name}</h1>
        {modified && (
          <p className="mb-2 flex flex-wrap items-center gap-x-1 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Last modified</span>
            <time dateTime={modified.toISOString()}>
              {formatDateTime(modified)}
            </time>
            <span aria-hidden="true">·</span>
            <RelativeTime date={modified} />
          </p>
        )}
        <button
          type="button"
          onClick={() => onShowInGarage(tote.position)}
          className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {path}
          <span className="font-normal text-blue-500 dark:text-blue-400">· Show me</span>
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
                  ? "border-green-400 bg-green-50 text-green-600 dark:border-green-600 dark:bg-green-950/40 dark:text-green-400"
                  : "border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500"
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
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <img
                src={newItemImage}
                alt="New item preview"
                className="h-12 w-12 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
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
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {totalThings} things total
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="apple-card p-8 text-center text-gray-500 dark:text-gray-400">
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
                        className="h-14 w-14 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                      />
                    </button>
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300 dark:bg-gray-800 dark:text-gray-600">
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`line-clamp-2 break-words font-semibold leading-snug ${
                        out ? "text-gray-400 line-through dark:text-gray-500" : "text-gray-900 dark:text-gray-100"
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
                  <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
                    <button
                      type="button"
                      onClick={() => changeQty(item, -1)}
                      disabled={qty === 0}
                      aria-label={`Use one ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 disabled:opacity-30 dark:text-gray-200"
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span
                      className="w-7 text-center text-sm font-bold text-gray-900 dark:text-gray-100"
                      aria-label={`Quantity: ${qty}`}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeQty(item, 1)}
                      aria-label={`Add one ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 dark:text-gray-200"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    aria-label={`Remove ${item.name}`}
                    className="flex h-11 w-9 items-center justify-center rounded-lg text-gray-400 dark:text-gray-500"
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
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Pick an empty spot. It&apos;s now in {path}.
          </p>
          {walls.map((wall) => (
            <div key={wall.id} className="mb-4">
              <h3 className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">
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
                          ? "border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
                          : "border-blue-200 bg-white text-blue-700 active:bg-blue-50 dark:border-blue-800 dark:bg-gray-800 dark:text-blue-300 dark:active:bg-blue-950"
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
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            “{tote.name}” and its {items.length} item
            {items.length === 1 ? "" : "s"} will be removed. You&apos;ll get a
            few seconds to undo.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSheet(null)}
              className="min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300"
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
