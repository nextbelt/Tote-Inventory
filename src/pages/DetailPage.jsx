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
import ItemEditSheet from "../components/ItemEditSheet";
import Sheet from "../components/Sheet";
import { useToast } from "../components/Toast";
import TotePicker from "../components/TotePicker";
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
  updateItem,
} from "../utils/itemOps";
import { leftoverText, parseItems } from "../utils/parseItems";
import { validateImageFile } from "../utils/validation";
import ParsePreview from "../components/ParsePreview";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const EMPTY_ITEMS = [];
const QTY_FLUSH_MS = 700;
const HIGHLIGHT_MS = 3500;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The editable fields of an item as they are now (for Undo). */
const snapshotFields = (item, keys) => {
  const prev = {};
  keys.forEach((key) => {
    if (key === "qty") prev.qty = itemQty(item);
    else prev[key] = item[key] ?? null;
  });
  return prev;
};

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
  highlightItemId,
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
  const deletingRef = useRef(false);
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
  const parsedDraft = useMemo(() => parseItems(newItemName), [newItemName]);
  const draftCount = parsedDraft.items.length;
  const [sheet, setSheet] = useState(null); // "move" | "delete" | null
  const [lightbox, setLightbox] = useState(null);
  // Item being edited / moved: a snapshot of the row as it was tapped, so
  // the sheet never vanishes mid-edit if the other phone touches the list.
  const [editing, setEditing] = useState(null);
  const [movingItem, setMovingItem] = useState(null);
  // Row elements by ORIGINAL item id (numbers and strings never mix up)
  const rowRefs = useRef(new Map());
  const [highlighted, setHighlighted] = useState(null);

  const replaceStaged = useCallback((next) => {
    stagedRef.current = next;
    setStaged(next);
  }, []);

  /**
   * Save one item operation; it stays visible while in flight. Resolves to
   * the saved tote, or null when the save failed (the user has been told —
   * with `onError` when given, else the service's message).
   *
   * Pass `key` to take over an overlay entry that is already showing (see
   * handleMoveItem); it is dropped when this save settles.
   */
  const runOp = useCallback(
    async (apply, { onError, key = newId() } = {}) => {
      setInflight((prev) =>
        prev.some((op) => op.key === key) ? prev : [...prev, { key, apply }]
      );
      try {
        return await updateItems(toteRef.current.id, apply);
      } catch (err) {
        if (onError) onError(err);
        else toast.error(err.message);
        return null;
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
    // While a delete is in flight, staged taps are held (see handleDelete):
    // saving them would target a tote that is disappearing.
    if (deletingRef.current) return Promise.resolve();
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
      // Leaving mid-delete: the Undo snapshot already carries the taps
      if (deletingRef.current) return;
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

  /**
   * Save the drafted items as ONE op. If it fails, the typed text and photo
   * go back into the box and the error toast offers Retry, which re-runs the
   * very same op (same item ids, so it can't double-add if the first try
   * actually landed).
   */
  const attemptAdd = (draft) =>
    runOp(draft.op, {
      onError: (err) => {
        setNewItemName((cur) =>
          cur.trim() ? `${draft.text}\n${cur}` : draft.text
        );
        if (draft.image) setNewItemImage((cur) => cur ?? draft.image);
        toast.error(err.message, {
          actionLabel: "Retry",
          duration: 8000,
          onAction: () => {
            // Take back what was restored above so it isn't there twice
            setNewItemName((cur) =>
              cur === draft.text
                ? ""
                : cur.startsWith(`${draft.text}\n`)
                ? cur.slice(draft.text.length + 1)
                : cur
            );
            setNewItemImage((cur) => (cur === draft.image ? null : cur));
            attemptAdd(draft);
          },
        });
      },
    });

  const handleAddItem = async () => {
    const parsed = parseItems(newItemName);
    if (parsed.items.length === 0) return;
    // A photo goes on a single item only; with several it stays in the box
    const single = parsed.items.length === 1;
    const image = single ? newItemImage : null;
    const built = parsed.items.map(({ name, qty }) => ({
      id: newId(),
      name,
      image,
      qty,
    }));
    const draft = {
      op: composeOps(...built.map(addItem)),
      text: parsed.sources.join("\n"),
      image,
    };
    setAdding(true);
    // Anything that couldn't be added (too long, past the cap) stays typed
    setNewItemName(leftoverText(parsed));
    if (single) setNewItemImage(null);
    await attemptAdd(draft);
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

  // ------ edit one item ------
  /** Land staged +/- first so the sheet opens on the current count. */
  const openEdit = (item) => {
    flushStaged();
    setEditing(item);
  };

  /** One updateItem op with only the changed fields; Undo puts them back. */
  const handleEditSave = async (prev, fields) => {
    setEditing(null);
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    // A staged delta must never land on top of an exact count, so flush it
    // first — the per-tote write queue keeps the order (delta, then set).
    flushStaged();
    const saved = await runOp(updateItem(prev.id, fields));
    if (!saved) return;
    const list = Array.isArray(saved.items) ? saved.items : [];
    if (!list.some((it) => it.id === prev.id)) {
      toast.error(
        `“${prev.name}” was removed on the other phone, so there was nothing to update.`
      );
      return;
    }
    const before = snapshotFields(prev, keys);
    toast.show(`Updated “${fields.name ?? prev.name}”`, {
      actionLabel: "Undo",
      onAction: () => runOp(updateItem(prev.id, before)),
    });
  };

  // ------ move one item to another tote ------
  /** From the edit sheet or directly: land staged taps, then pick a tote. */
  const openMoveItem = (item) => {
    flushStaged();
    setEditing(null);
    setMovingItem(item);
  };

  /**
   * Add to the destination FIRST, then remove here — an item can never be
   * lost, only (on a failed second step) briefly be in both totes.
   *
   * `item` is the snapshot the sheet / picker opened on; the copy that
   * travels is the item AS IT IS NOW, so an edit the other phone made in
   * the meantime moves with it (and an item they removed isn't revived).
   */
  const handleMoveItem = async (item, dest) => {
    setMovingItem(null);
    const source = toteRef.current;
    const index = items.findIndex((it) => it.id === item.id);
    if (index === -1) {
      toast.error(
        `“${item.name}” was removed on the other phone, so there was nothing to move.`
      );
      return;
    }
    const moved = { ...items[index] };
    // Hide it here from the first step on: anything done to the still-visible
    // row (a + tap, a rename, a second move) would land on the source copy
    // and be wiped out — or duplicated — by the remove that follows.
    const key = newId();
    const hide = removeItemOp(moved.id);
    setInflight((prev) => [...prev, { key, apply: hide }]);
    try {
      await updateItems(dest.id, addItem(moved));
    } catch (err) {
      // Nothing moved — bring the row straight back
      setInflight((prev) => prev.filter((op) => op.key !== key));
      toast.error(err.message);
      return;
    }
    // Same key, so the row stays hidden continuously until this settles
    const removed = await runOp(hide, {
      key,
      onError: () =>
        toast.error(
          `“${moved.name}” was added to “${dest.name}” but couldn't be removed from “${source.name}” — it is now in both. Please check.`
        ),
    });
    if (!removed) return;
    toast.show(`Moved “${moved.name}” to “${dest.name}”`, {
      actionLabel: "Undo",
      onAction: async () => {
        // Same add-first order on the way back
        const restored = await runOp(restoreItem(moved, index));
        if (!restored) return;
        try {
          await updateItems(dest.id, removeItemOp(moved.id));
        } catch {
          toast.error(
            `“${moved.name}” is back in “${source.name}” but couldn't be removed from “${dest.name}” — it is now in both. Please check.`
          );
        }
      },
    });
  };

  // ------ highlight (opened from search) ------
  useEffect(() => {
    if (highlightItemId === undefined || highlightItemId === null) {
      return undefined;
    }
    setHighlighted(highlightItemId);
    const raf = requestAnimationFrame(() => {
      rowRefs.current.get(highlightItemId)?.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [highlightItemId]);

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
    // delete is in flight — no debounce, background/pagehide flush, or new
    // tap may save to a tote that is disappearing (which would show a bogus
    // "couldn't find" error).
    clearTimeout(saveTimerRef.current);
    deletingRef.current = true;
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
      deletingRef.current = false;
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
            <textarea
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds; Shift+Enter starts another line (one item per line)
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddItem();
                }
              }}
              rows={Math.min(4, newItemName.split("\n").length)}
              placeholder="Add an item…"
              aria-label="Add items"
              maxLength={5000}
              autoComplete="off"
              autoCapitalize="sentences"
              className="apple-input block min-w-0 flex-1 resize-none leading-normal"
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
              disabled={draftCount === 0 || uploading || adding}
              className={`apple-button flex h-12 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 ${
                draftCount > 1
                  ? "gap-1 whitespace-nowrap !px-3 text-sm"
                  : "w-12 !p-0"
              }`}
              aria-label={draftCount > 1 ? `Add ${draftCount} items` : "Add item"}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              {draftCount > 1 && `Add ${draftCount} items`}
            </button>
          </div>
          <ParsePreview parsed={parsedDraft} hasImage={Boolean(newItemImage)} />
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
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el);
                    else rowRefs.current.delete(item.id);
                  }}
                  className={`apple-card flex items-center gap-3 p-2.5 ${
                    highlighted === item.id ? "item-highlight" : ""
                  }`}
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
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    aria-label={`Edit ${item.name}`}
                    className="min-h-[44px] min-w-0 flex-1 rounded-lg text-left"
                  >
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
                  </button>
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

      {/* Edit item sheet */}
      {editing && (
        <ItemEditSheet
          key={editing.id}
          item={editing}
          onSave={(fields) => handleEditSave(editing, fields)}
          onClose={() => setEditing(null)}
          onMove={() => openMoveItem(editing)}
          onViewPhoto={setLightbox}
        />
      )}

      {/* Move item to another tote */}
      {movingItem && (
        <TotePicker
          title={`Move “${movingItem.name}” to…`}
          totes={Object.values(totesByPosition)}
          excludeId={tote.id}
          onPick={(dest) => handleMoveItem(movingItem, dest)}
          onClose={() => setMovingItem(null)}
        />
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
