import { Camera, MoveRight } from "lucide-react";
import { useId, useState } from "react";
import Sheet from "./Sheet";
import { toteService } from "../services/toteService";
import { MAX_ITEM_NAME_LENGTH } from "../utils/constants";
import { compressImage } from "../utils/images";
import { itemQty } from "../utils/itemOps";
import {
  MAX_ITEM_NOTE_LENGTH,
  validateImageFile,
  validateItemName,
  validateItemNote,
} from "../utils/validation";

// The +/- row has room for four digits; nobody keeps 10,000 of anything here.
const MAX_COUNT = 9999;

/**
 * Edit one item: name, exact count, photo, note, or move it to another tote.
 *
 * Save hands back ONLY the fields that changed ({ name?, image?, qty?,
 * note? }), so the caller can save a minimal updateItem op (and Undo only
 * what was touched). A cleared note is handed back as `note: null` (the op
 * removes the key). Nothing is written here — the caller owns persistence.
 *
 * Props:
 *   item        – the item as currently shown (original id value kept as-is)
 *   onSave      – (changedFields) => void; called with {} when nothing changed
 *   onClose     – cancel / dismiss
 *   onMove      – open the tote picker for this item
 *   onViewPhoto – open the lightbox for the current photo (optional)
 */
export default function ItemEditSheet({ item, onSave, onClose, onMove, onViewPhoto }) {
  const [name, setName] = useState(item.name ?? "");
  const [count, setCount] = useState(String(itemQty(item)));
  const [image, setImage] = useState(item.image ?? null);
  const [note, setNote] = useState(
    typeof item.note === "string" ? item.note : ""
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const countId = `${baseId}-count`;
  const countHintId = `${baseId}-count-hint`;
  const noteId = `${baseId}-note`;

  const handlePhotoPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const url = await toteService.uploadImage(
        compressed,
        `${Date.now()}-${compressed.name}`
      );
      setImage(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    // The Save button is disabled while a photo uploads, but Enter in a
    // field lands here too — saving now would keep the old photo, close the
    // sheet, and orphan the upload when it finishes.
    if (uploading) return;
    const nameCheck = validateItemName(name);
    if (!nameCheck.valid) {
      setError(nameCheck.error);
      return;
    }
    const trimmedCount = count.trim();
    const qty = trimmedCount === "" ? NaN : Number(trimmedCount);
    if (!Number.isInteger(qty) || qty < 0) {
      setError("Count must be a whole number, 0 or more.");
      return;
    }
    if (qty > MAX_COUNT) {
      setError(`Count can be at most ${MAX_COUNT.toLocaleString("en-US")}.`);
      return;
    }
    const noteCheck = validateItemNote(note);
    if (!noteCheck.valid) {
      setError(noteCheck.error);
      return;
    }

    const fields = {};
    const trimmedName = name.trim();
    if (trimmedName !== item.name) fields.name = trimmedName;
    if (qty !== itemQty(item)) fields.qty = qty;
    if ((image ?? null) !== (item.image ?? null)) fields.image = image;
    const trimmedNote = note.trim();
    const prevNote = typeof item.note === "string" ? item.note.trim() : "";
    if (trimmedNote !== prevNote) fields.note = trimmedNote || null;
    onSave(fields);
  };

  return (
    <Sheet title="Edit item" onClose={onClose}>
      <div className="mb-4 flex items-center gap-3">
        {image ? (
          <button
            type="button"
            onClick={() => onViewPhoto?.({ ...item, image })}
            aria-label={`View photo of ${item.name}`}
            className="shrink-0"
          >
            <img
              src={image}
              alt={item.name}
              className={`h-20 w-20 rounded-xl border border-gray-200 object-cover dark:border-gray-700 ${
                uploading ? "animate-pulse" : ""
              }`}
            />
          </button>
        ) : (
          <span
            className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-300 dark:bg-gray-800 dark:text-gray-600 ${
              uploading ? "animate-pulse" : ""
            }`}
          >
            <Camera className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <label
            className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 px-1 font-semibold text-blue-600 dark:text-blue-400 ${
              uploading ? "opacity-50" : ""
            }`}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading…" : image ? "Replace photo" : "Add photo"}
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoPick}
              className="hidden"
              disabled={uploading}
            />
          </label>
          {image && (
            <button
              type="button"
              onClick={() => setImage(null)}
              disabled={uploading}
              className="min-h-[44px] px-1 font-semibold text-red-500 disabled:opacity-50"
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <label
          htmlFor={nameId}
          className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300"
        >
          Name
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave();
          }}
          maxLength={MAX_ITEM_NAME_LENGTH}
          autoComplete="off"
          autoCapitalize="sentences"
          className="apple-input w-full"
        />
      </div>

      <div className="mb-4">
        <label
          htmlFor={countId}
          className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300"
        >
          Count
        </label>
        <input
          id={countId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_COUNT}
          step={1}
          aria-describedby={countHintId}
          value={count}
          onChange={(e) => {
            setCount(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave();
          }}
          className="apple-input w-full"
        />
        <p id={countHintId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          How many are in the tote right now.
        </p>
      </div>

      <div className="mb-4">
        <label
          htmlFor={noteId}
          className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300"
        >
          Note{" "}
          <span className="font-normal text-gray-500 dark:text-gray-400">
            (optional)
          </span>
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          rows={2}
          maxLength={MAX_ITEM_NOTE_LENGTH}
          placeholder="e.g. needs new batteries"
          autoComplete="off"
          autoCapitalize="sentences"
          className="apple-input w-full resize-none leading-normal"
        />
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-red-500">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onMove}
        className="mb-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
      >
        <MoveRight className="h-4 w-4" aria-hidden="true" />
        Move to another tote…
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={uploading}
          className="apple-button flex-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
