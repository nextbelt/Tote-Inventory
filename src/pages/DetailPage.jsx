import {
  ArrowLeftRight,
  Camera,
  ChevronLeft,
  Clock,
  Edit2,
  MapPin,
  Minus,
  MoveRight,
  Plus,
  StickyNote,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ItemEditSheet from "../components/ItemEditSheet";
import Sheet from "../components/Sheet";
import TagEditor from "../components/TagEditor";
import { useToast } from "../components/Toast";
import TotePicker from "../components/TotePicker";
import { useTotes } from "../hooks/useTotes";
import { describePosition, describeSpot } from "../utils/constants";
import { compressImage } from "../utils/images";
import { prefersReducedMotion } from "../utils/motion";
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
import {
  MAX_NOTES_LENGTH,
  normalizeNotes,
  normalizeTags,
  validateImageFile,
  validateNotes,
  validateTags,
} from "../utils/validation";
import AutoGrowTextarea from "../components/AutoGrowTextarea";
import ParsePreview from "../components/ParsePreview";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const EMPTY_ITEMS = [];
const QTY_FLUSH_MS = 700;
const HIGHLIGHT_MS = 3500;

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

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const lowerTag = (tag) => tag.toLocaleLowerCase();

/**
 * What the tag editor changed, as a delta against the list it opened on —
 * so it can be re-applied to whatever the tags are NOW (the other phone may
 * have edited them while the sheet was open) instead of replacing them.
 * Tags compare case-insensitively, like normalizeTags dedupes them.
 */
const diffTags = (opened, next) => {
  const openedKeys = new Set(opened.map(lowerTag));
  const nextKeys = new Set(next.map(lowerTag));
  return {
    added: next.filter((t) => !openedKeys.has(lowerTag(t))),
    removed: opened.filter((t) => !nextKeys.has(lowerTag(t))),
  };
};

/** `current` without `removed` (by case-insensitive key), then `added`. */
const applyTagDelta = (current, { added, removed }) => {
  const gone = new Set(removed.map(lowerTag));
  return normalizeTags([
    ...current.filter((t) => !gone.has(lowerTag(t))),
    ...added,
  ]);
};

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
    capabilities,
    updateItems,
    updateTote,
    deleteTote,
    moveTote,
    restoreTote,
    swapTotes,
    recordRemovedItems,
  } = useTotes();
  const toast = useToast();
  // Until the owners run the setup SQL these columns don't exist: the UI for
  // them is hidden entirely (never a disabled hint that tempts a tap).
  const canTag = Boolean(capabilities?.tags);
  const canNote = Boolean(capabilities?.notes);
  const canSwap = Boolean(capabilities?.swap);

  // Always read the latest version from the store
  const tote = totes.find((t) => t.id === initialTote.id) || initialTote;
  const storeItems = Array.isArray(tote.items) ? tote.items : EMPTY_ITEMS;
  const toteTags = useMemo(() => normalizeTags(tote.tags), [tote.tags]);
  // Tags already used on OTHER totes, most common first: the household's own
  // vocabulary, so "Xmas" and "christmas" don't both creep in.
  const tagSuggestions = useMemo(() => {
    const seen = new Map(); // lower-cased → { tag, n }
    totes.forEach((t) => {
      if (t.id === tote.id) return;
      normalizeTags(t.tags).forEach((tag) => {
        const key = tag.toLocaleLowerCase();
        const cur = seen.get(key);
        if (cur) cur.n += 1;
        else seen.set(key, { tag, n: 1 });
      });
    });
    return [...seen.values()]
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
      .map((e) => e.tag);
  }, [totes, tote.id]);

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
  // Latest store, for handlers that run later than the render they came
  // from (toast Undo, a confirm tapped after a realtime refresh)
  const totesRef = useRef(totes);
  totesRef.current = totes;

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
  // Where this tote was when the Move sheet opened: a swap confirmed later
  // must still be about THAT spot, or it is refused
  const [moveFrom, setMoveFrom] = useState(null);
  // Occupied slot tapped in the Move sheet: the tote to swap places with
  const [swapWith, setSwapWith] = useState(null);
  // Tag editor: null when closed, else the list it opened on (its changes
  // are saved as a delta against the live tags, never as a replacement)
  const [tagEditor, setTagEditor] = useState(null);
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  // The (normalized) note the editor opened on, to spot the other phone's
  // edit before overwriting it — and their text once such a clash is found
  const [notesOpenedOn, setNotesOpenedOn] = useState(null);
  const [notesConflict, setNotesConflict] = useState(null);
  const [savingNotes, setSavingNotes] = useState(false);
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
   *
   * Pass `persist` to hand the service a DIFFERENT function from the one
   * the overlay applies at render time — e.g. one that also notes what it
   * found in the authoritative list (the service re-runs it on every CAS
   * retry, so the last, successful attempt is what it saw).
   */
  const runOp = useCallback(
    async (apply, { onError, key = newId(), persist } = {}) => {
      setInflight((prev) =>
        prev.some((op) => op.key === key) ? prev : [...prev, { key, apply }]
      );
      try {
        return await updateItems(toteRef.current.id, persist ?? apply);
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

  /**
   * While a delete is in flight nothing but +/- taps (which are held) may
   * start: an edit, move or remove would save to a tote that is vanishing,
   * or — if the delete then fails — land out of order with the held taps.
   */
  const blockedByDelete = () => {
    if (!deletingRef.current) return false;
    toast.show(`Deleting “${toteRef.current.name}”…`);
    return true;
  };

  /**
   * Remember explicitly removed items in the Recently deleted bin — best
   * effort: the removal itself has already landed, so a failure here is
   * neither shown nor allowed to revert anything. Never called for a move
   * (the item lives on in the other tote) nor for a failed removal.
   */
  const recordRemoval = useCallback(
    (removed) => {
      const t = toteRef.current;
      Promise.resolve()
        .then(() =>
          recordRemovedItems(
            { id: t.id, name: t.name, position: t.position },
            removed
          )
        )
        .catch(() => {});
    },
    [recordRemovedItems]
  );

  const removeItem = (item) => {
    if (blockedByDelete()) return;
    const index = items.findIndex((it) => it.id === item.id);
    // Land any staged +/- first so Undo brings back the quantity you saw
    flushStaged();
    // The bin must remember what this op REALLY took out of the stored
    // list, not the row on screen: if the other phone moved or removed it
    // already, the op finds nothing, and recording the stale row would let
    // a later restore put the item in two totes. So the op handed to the
    // service notes the row it found (the overlay keeps the plain op —
    // render-time applications must not overwrite this).
    const remove = removeItemOp(item.id);
    let hit = null;
    const persist = (list) => {
      hit = (Array.isArray(list) ? list : []).find((it) => it.id === item.id) ?? null;
      return remove(list);
    };
    runOp(remove, { persist }).then((saved) => {
      // `hit` carries the stored count, which includes the staged taps the
      // flush above landed first (same per-tote write queue)
      if (saved && hit) recordRemoval([hit]);
    });
    toast.show(`Removed “${item.name}”`, {
      actionLabel: "Undo",
      // Restore-by-id: safe even if the other phone changed the list since
      onAction: () => runOp(restoreItem(item, index)),
    });
  };

  // ------ edit one item ------
  /** Land staged +/- first so the sheet opens on the current count. */
  const openEdit = (item) => {
    if (blockedByDelete()) return;
    flushStaged();
    setEditing(item);
  };

  /** One updateItem op with only the changed fields; Undo puts them back. */
  const handleEditSave = async (prev, fields) => {
    setEditing(null);
    if (deletingRef.current) {
      toast.show(
        `Deleting “${toteRef.current.name}”, so the change to “${prev.name}” wasn't saved.`
      );
      return;
    }
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    // An exact count replaces whatever is staged for this item: the sheet
    // opened on a count that already included the staged delta, so the
    // delta must never land as well. DROP it rather than flush it — a flush
    // can be held (delete in flight) and would then land AFTER the set.
    if ("qty" in fields && stagedRef.current.has(prev.id)) {
      const next = new Map(stagedRef.current);
      next.delete(prev.id);
      replaceStaged(next);
    }
    // Other items' staged taps land first (per-tote write queue keeps order)
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
    if (blockedByDelete()) return;
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
    if (blockedByDelete()) return;
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

  // ------ tote notes (capabilities.notes) ------
  const openNotes = () => {
    if (blockedByDelete()) return;
    setNotesDraft(typeof tote.notes === "string" ? tote.notes : "");
    setNotesOpenedOn(normalizeNotes(tote.notes));
    setNotesConflict(null);
    setNotesEditing(true);
  };

  const closeNotes = () => {
    setNotesConflict(null);
    setNotesEditing(false);
  };

  /**
   * Save the draft. updateTote is a plain last-writer-wins patch, so before
   * overwriting, check the note the other phone may have saved while the
   * editor was open: if it differs from what this editor opened on, show
   * their text and let the user choose (`force` is that choice).
   */
  const handleSaveNotes = async ({ force = false } = {}) => {
    if (blockedByDelete()) return;
    const notes = normalizeNotes(notesDraft);
    const check = validateNotes(notes);
    if (!check.valid) {
      toast.error(check.error);
      return;
    }
    const theirs = normalizeNotes(toteRef.current.notes);
    // Already says this (or the user changed nothing): nothing to write
    if (notes === theirs || notes === notesOpenedOn) {
      closeNotes();
      return;
    }
    if (theirs !== notesOpenedOn && !force) {
      setNotesConflict(theirs);
      return;
    }
    setSavingNotes(true);
    try {
      await updateTote(tote.id, { notes });
      closeNotes();
    } catch (err) {
      // Keep the editor open so what was typed isn't lost
      toast.error(err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  // ------ tags (capabilities.tags) ------
  const openTagEditor = () => {
    if (blockedByDelete()) return;
    setTagEditor({ opened: toteTags });
  };

  /**
   * The editor hands back a full list, but only its CHANGES are saved: the
   * tags it added and removed, applied to the tags as they are now. So a tag
   * the other phone added while the sheet was open survives, and Undo takes
   * back only this edit (not theirs).
   */
  const handleSaveTags = async (next) => {
    const opened = tagEditor?.opened ?? toteTags;
    setTagEditor(null);
    if (blockedByDelete()) return;
    const delta = diffTags(opened, next);
    if (delta.added.length === 0 && delta.removed.length === 0) return;
    const current = normalizeTags(toteRef.current.tags);
    const merged = applyTagDelta(current, delta);
    if (sameList(merged, current)) return; // the other phone already did it
    const check = validateTags(merged);
    if (!check.valid) {
      toast.error(check.error);
      return;
    }
    // What this save really changes (a tag the other phone had already
    // added isn't ours to take back on Undo)
    const effective = diffTags(current, merged);
    try {
      await updateTote(tote.id, { tags: merged });
      toast.show(merged.length === 0 ? "Tags removed" : "Tags updated", {
        actionLabel: "Undo",
        onAction: () => {
          // Same delta backwards, again on top of whatever the tags are NOW
          const reverted = applyTagDelta(normalizeTags(toteRef.current.tags), {
            added: effective.removed,
            removed: effective.added,
          });
          return updateTote(tote.id, { tags: reverted }).catch((err) =>
            toast.error(err.message)
          );
        },
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ------ move / swap / delete ------
  const openMoveSheet = () => {
    setMoveFrom(tote.position);
    setSwapWith(null);
    setSheet("move");
  };

  const closeMoveSheet = () => {
    setSheet(null);
    setSwapWith(null);
  };

  /** The tote at `position` in the LATEST store (undefined when empty). */
  const toteAt = (position) =>
    totesRef.current.find((t) => t.position === position);

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

  /**
   * Trade spots with `other` in one step (cloud: one transaction).
   *
   * `other` is the occupant as it was when its slot was tapped, and the
   * confirm sheet promised THAT trade (this tote to `other`'s spot, `other`
   * here). swapTotes trades whatever spots the two hold at call time, so if
   * either tote moved on the other phone in between, the trade would be a
   * different one than the user confirmed — refuse it and say why. Undo is
   * held to the same promise: it only swaps back while both are still where
   * the swap left them, or the physical totes and printed labels would end
   * up not matching the app.
   */
  const handleSwap = async (other) => {
    closeMoveSheet();
    const from = moveFrom ?? tote.position;
    const to = other.position;
    const me = toteRef.current;
    if (me.position !== from) {
      toast.error(
        `“${me.name}” was moved on the other phone, so nothing was swapped.`
      );
      return;
    }
    if (toteAt(to)?.id !== other.id) {
      toast.error(
        `“${other.name}” was moved on the other phone, so nothing was swapped.`
      );
      return;
    }
    try {
      await swapTotes(tote.id, other.id);
      const { path } = describePosition(to);
      toast.show(`Swapped with “${other.name}” — now in ${path}`, {
        actionLabel: "Undo",
        // Positions only, so item edits made meanwhile on either tote are
        // untouched — but only while both are still where the swap put them
        onAction: () => {
          if (toteAt(to)?.id !== tote.id || toteAt(from)?.id !== other.id) {
            toast.error(
              `Can't undo — “${me.name}” or “${other.name}” was moved since.`
            );
            return Promise.resolve();
          }
          return swapTotes(tote.id, other.id).catch((err) =>
            toast.error(err.message)
          );
        },
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    // The id lets Undo bring back the SAME row (restoreTote prefers it).
    // Without it, Undo has to find the tombstone by name + spot in the hook's
    // `deleted` list, which a slow pre-delete load landing afterwards can
    // overwrite — then Undo would create a duplicate tote instead.
    const snapshot = {
      id: tote.id,
      name: tote.name,
      position: tote.position,
      items,
    };
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
      toast.show(
        `Deleted “${snapshot.name}” — it's in Recently deleted for 30 days`,
        {
          actionLabel: "Undo",
          onAction: () =>
            restoreTote(snapshot).catch((err) => toast.error(err.message)),
        }
      );
    } catch (err) {
      deletingRef.current = false;
      toast.error(err.message);
      // Delete failed, so the tote is still here — save the held taps
      if (stagedRef.current.size > 0) {
        saveTimerRef.current = setTimeout(flushStaged, QTY_FLUSH_MS);
      }
    }
  };

  const path = describeSpot(tote.position, walls);
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
              onClick={openMoveSheet}
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

        {/* Tags (only once the setup SQL has added the column) */}
        {canTag && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {toteTags.length > 0 && (
              <ul aria-label="Tags" className="contents">
                {toteTags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex min-h-[32px] items-center rounded-full bg-blue-50 px-3 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={openTagEditor}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-3 text-sm font-semibold text-gray-600 dark:border-gray-600 dark:text-gray-300"
            >
              <Tag className="h-4 w-4" aria-hidden="true" />
              {toteTags.length > 0 ? "Edit tags" : "Add tag"}
            </button>
          </div>
        )}

        {/* Notes (only once the setup SQL has added the column) */}
        {canNote &&
          (notesEditing ? (
            <div className="apple-card mb-5 p-3">
              <label
                htmlFor="tote-notes"
                className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300"
              >
                Notes
              </label>
              <textarea
                id="tote-notes"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                maxLength={MAX_NOTES_LENGTH}
                placeholder="Anything worth remembering about this tote…"
                autoComplete="off"
                autoCapitalize="sentences"
                autoFocus
                className="apple-input w-full resize-none leading-normal"
              />
              {notesConflict !== null ? (
                <div
                  role="alert"
                  className="mt-2 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/40"
                >
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    The other phone changed this note while you were editing:
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300">
                    {notesConflict || "(note removed)"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={closeNotes}
                      disabled={savingNotes}
                      className="min-h-[44px] flex-1 rounded-xl border border-gray-300 px-3 font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
                    >
                      Keep theirs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveNotes({ force: true })}
                      disabled={savingNotes}
                      className="apple-button min-h-[44px] flex-1 !py-0 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingNotes ? "Saving…" : "Replace with mine"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {notesDraft.length}/{MAX_NOTES_LENGTH}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeNotes}
                      disabled={savingNotes}
                      className="min-h-[44px] rounded-xl border border-gray-300 px-4 font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveNotes()}
                      disabled={savingNotes}
                      className="apple-button min-h-[44px] !py-0 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingNotes ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={openNotes}
              className="apple-card mb-5 block min-h-[44px] w-full p-3 text-left"
            >
              {tote.notes ? (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-400">
                    {tote.notes}
                  </p>
                  <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    <Edit2 className="h-3 w-3" aria-hidden="true" />
                    Edit note
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 dark:text-gray-400">
                  <StickyNote className="h-4 w-4" aria-hidden="true" />
                  Add a note
                </span>
              )}
            </button>
          ))}

        {/* Quick add */}
        <div className="apple-card mb-5 p-3">
          <div className="flex gap-2">
            <AutoGrowTextarea
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds (type a comma to start the next item; pasted or
                // dictated lines work too). Not while an IME is composing.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
                    {typeof item.note === "string" && item.note.trim() && (
                      <p className="line-clamp-2 break-words text-xs leading-snug text-gray-500 dark:text-gray-400">
                        {item.note}
                      </p>
                    )}
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

      {/* Move sheet (occupied slots offer a swap once the SQL has been run) */}
      {sheet === "move" && swapWith && (
        <Sheet
          title={`Swap with “${swapWith.name}” (${swapWith.position})?`}
          onClose={closeMoveSheet}
        >
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            “{tote.name}” goes to {swapWith.position} and “{swapWith.name}”
            comes here to {tote.position}. Both keep their items.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSwapWith(null)}
              className="min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => handleSwap(swapWith)}
              className="apple-button flex flex-1 items-center justify-center gap-2"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              Swap
            </button>
          </div>
        </Sheet>
      )}
      {sheet === "move" && !swapWith && (
        <Sheet title={`Move “${tote.name}”`} onClose={closeMoveSheet}>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            {canSwap
              ? "Pick an empty spot, or tap another tote to swap places with it."
              : "Pick an empty spot."}{" "}
            It&apos;s now in {path}.
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
                  const swappable = Boolean(occupant) && !isHere && canSwap;
                  return (
                    <button
                      key={pos}
                      type="button"
                      disabled={Boolean(occupant) && !swappable}
                      onClick={() =>
                        swappable ? setSwapWith(occupant) : handleMove(pos)
                      }
                      aria-label={
                        swappable
                          ? `Swap with ${occupant.name} in ${pos}`
                          : undefined
                      }
                      className={`min-h-[48px] rounded-xl border text-xs font-bold ${
                        isHere
                          ? "border-blue-500 bg-blue-500 text-white"
                          : swappable
                          ? "border-gray-300 bg-white text-gray-700 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:active:bg-gray-700"
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

      {/* Tag editor */}
      {tagEditor && canTag && (
        <TagEditor
          tags={tagEditor.opened}
          suggestions={tagSuggestions}
          onSave={handleSaveTags}
          onClose={() => setTagEditor(null)}
        />
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
