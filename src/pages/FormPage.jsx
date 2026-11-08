import { Camera, ChevronLeft, Plus, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import AutoGrowTextarea from "../components/AutoGrowTextarea";
import ParsePreview from "../components/ParsePreview";
import { useToast } from "../components/Toast";
import { useTotes } from "../hooks/useTotes";
import { toteService } from "../services/toteService";
import { describePosition } from "../utils/constants";
import { compressImage } from "../utils/images";
import { diffItemsOp } from "../utils/itemOps";
import { leftoverText, parseItems } from "../utils/parseItems";
import { validateImageFile, validateToteName } from "../utils/validation";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function FormPage({ editTote, position, onBack, onSaved }) {
  const { saveTote, updateTote, updateItems, recordRemovedItems, totesByPosition } =
    useTotes();
  const toast = useToast();

  const [toteName, setToteName] = useState(editTote?.name || "");
  const [items, setItems] = useState(editTote?.items || []);
  const [currentItem, setCurrentItem] = useState({ name: "", image: null });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isEditing = !!editTote;
  const { path } = describePosition(position);

  // ------ Image upload ------
  const handleImageUpload = async (e) => {
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
      const imageUrl = await toteService.uploadImage(
        compressed,
        `${Date.now()}-${compressed.name}`
      );
      setCurrentItem((prev) => ({ ...prev, image: imageUrl }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ------ Item list management ------
  const parsedDraft = useMemo(
    () => parseItems(currentItem.name),
    [currentItem.name]
  );
  const draftCount = parsedDraft.items.length;

  const addItemToList = () => {
    const parsed = parseItems(currentItem.name);
    if (parsed.items.length === 0) return;
    // A photo goes on a single item only; with several it stays in the box
    const single = parsed.items.length === 1;
    const image = single ? currentItem.image : null;

    setItems((prev) => [
      ...prev,
      ...parsed.items.map(({ name, qty }) => ({
        id: newId(),
        name,
        image,
        qty,
      })),
    ]);
    // Anything that couldn't be added (too long, past the cap) stays typed
    setCurrentItem({
      name: leftoverText(parsed),
      image: single ? null : currentItem.image,
    });
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // ------ Save ------
  const handleSave = async () => {
    const nameCheck = validateToteName(toteName);
    if (!nameCheck.valid) {
      setError(nameCheck.error);
      return;
    }
    if (!position) {
      setError("Position is required.");
      return;
    }
    // A slot can hold only one tote — catch it before the database does
    const occupant = totesByPosition[position];
    if (!isEditing && occupant) {
      setError(
        `${position} already holds “${occupant.name}”. Go back and pick an empty slot.`
      );
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (isEditing) {
        // Patch only what actually changed. Never write the items snapshot
        // this form opened with — the other phone may have edited them.
        const fields = {};
        const name = toteName.trim();
        if (name !== (editTote.name || "").trim()) fields.name = name;
        if (position !== editTote.position) fields.position = position;
        if (Object.keys(fields).length > 0) {
          await updateTote(editTote.id, fields);
        }
        const itemsOp = diffItemsOp(editTote.items, items);
        if (itemsOp) {
          // Items taken off the list go to Recently deleted — but only the
          // ones the op REALLY removes from the stored list, as they are
          // stored. This form may have been open for minutes: an item the
          // other phone moved elsewhere since is no longer here (recording
          // it would let a restore duplicate it), and one they re-counted
          // must be remembered with their count. So the op handed to the
          // service notes what it found; the service re-runs it on every
          // CAS retry, so the last (successful) attempt is what counts.
          // Set compares ids with SameValueZero, so 7 and "7" stay apart.
          const kept = new Set(items.map((it) => it.id));
          const removedIds = new Set(
            (editTote.items || [])
              .filter((it) => !kept.has(it.id))
              .map((it) => it.id)
          );
          let actuallyRemoved = [];
          const op = (current) => {
            actuallyRemoved = (Array.isArray(current) ? current : []).filter(
              (it) => removedIds.has(it.id)
            );
            return itemsOp(current);
          };
          await updateItems(editTote.id, op);
          // Best effort, only once the removal has actually landed: a
          // failure to record is neither shown nor allowed to hold up the save.
          if (actuallyRemoved.length > 0) {
            const removed = actuallyRemoved;
            Promise.resolve()
              .then(() =>
                recordRemovedItems(
                  { id: editTote.id, name, position },
                  removed
                )
              )
              .catch(() => {});
          }
        }
      } else {
        await saveTote(
          { name: toteName.trim(), position, items },
          true
        );
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ------ Render ------
  return (
    <div
      className="min-h-[100dvh]"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
    >
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
            Back
          </button>
          <h1 className="apple-subtitle text-lg">
            {isEditing ? "Edit Tote" : "New Tote"}
          </h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4">
        <div className="apple-card space-y-6 p-4 sm:p-6">
          {/* Tote name */}
          <div>
            <label
              htmlFor="tote-name"
              className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >
              Tote name
            </label>
            <input
              id="tote-name"
              type="text"
              value={toteName}
              onChange={(e) => setToteName(e.target.value)}
              placeholder="e.g., Holiday Decorations"
              maxLength={100}
              autoComplete="off"
              autoCapitalize="words"
              autoFocus={!isEditing}
              className="apple-input w-full"
            />
          </div>

          {/* Position (read-only) */}
          <div>
            <span className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              Where it goes
            </span>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
              {position ? `${position} — ${path}` : "No position selected"}
            </div>
          </div>

          {/* Add items */}
          <div className="border-t border-gray-200 pt-5 dark:border-gray-700">
            <h3 className="apple-subtitle mb-3 text-lg">Add items</h3>
            <div className="flex gap-2">
              <AutoGrowTextarea
                value={currentItem.name}
                onChange={(e) =>
                  setCurrentItem((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Item name"
                rows={Math.min(4, currentItem.name.split("\n").length)}
                maxLength={5000}
                autoComplete="off"
                autoCapitalize="sentences"
                aria-label="Item name"
                className="apple-input block min-w-0 flex-1 resize-none leading-normal"
                onKeyDown={(e) => {
                  // Enter adds (type a comma to start the next item; pasted or
                  // dictated lines work too). Not while an IME is composing.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addItemToList();
                  }
                }}
              />
              <label
                className={`flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed ${
                  currentItem.image
                    ? "border-green-400 bg-green-50 text-green-600 dark:border-green-600 dark:bg-green-950/40 dark:text-green-400"
                    : "border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500"
                } ${uploading ? "animate-pulse" : ""}`}
              >
                <Camera className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">
                  {currentItem.image ? "Change photo" : "Add photo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
              <button
                type="button"
                onClick={addItemToList}
                disabled={draftCount === 0 || uploading}
                aria-label={
                  draftCount > 1 ? `Add ${draftCount} items` : "Add item to list"
                }
                className={`apple-button flex h-12 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 ${
                  draftCount > 1
                    ? "gap-1 whitespace-nowrap !px-3 text-sm"
                    : "w-12 !p-0"
                }`}
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                {draftCount > 1 && `Add ${draftCount} items`}
              </button>
            </div>
            <ParsePreview
              parsed={parsedDraft}
              hasImage={Boolean(currentItem.image)}
            />

            {currentItem.image && (
              <div className="mt-3 flex justify-center">
                <img
                  src={currentItem.image}
                  alt="Preview of new item"
                  className="h-28 w-28 rounded-xl border border-gray-200 object-cover shadow dark:border-gray-700"
                />
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="border-t border-gray-200 pt-5 dark:border-gray-700">
              <h3 className="apple-subtitle mb-3 text-lg">
                Items ({items.length})
              </h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                  >
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-12 w-12 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-semibold text-gray-800 dark:text-gray-200">
                      {item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-red-500"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!toteName.trim() || !position || saving || uploading}
            className="apple-button flex w-full items-center justify-center py-4 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="mr-2 h-5 w-5" aria-hidden="true" />
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Save Tote"}
          </button>
        </div>
      </main>
    </div>
  );
}
