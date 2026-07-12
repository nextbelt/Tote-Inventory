import { Camera, ChevronLeft, Plus, Save, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "../components/Toast";
import { useTotes } from "../hooks/useTotes";
import { toteService } from "../services/toteService";
import { describePosition } from "../utils/constants";
import { compressImage } from "../utils/images";
import {
  validateImageFile,
  validateItemName,
  validateToteName,
} from "../utils/validation";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function FormPage({ editTote, position, onBack, onSaved }) {
  const { saveTote, totesByPosition } = useTotes();
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
  const addItemToList = () => {
    const validation = validateItemName(currentItem.name);
    if (!validation.valid) return;

    setItems((prev) => [
      ...prev,
      { ...currentItem, name: currentItem.name.trim(), id: newId(), qty: 1 },
    ]);
    setCurrentItem({ name: "", image: null });
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
      const toteData = {
        ...(isEditing
          ? { id: editTote.id, created_at: editTote.created_at }
          : {}),
        name: toteName.trim(),
        position,
        items,
      };
      await saveTote(toteData, !isEditing);
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
              <input
                type="text"
                value={currentItem.name}
                onChange={(e) =>
                  setCurrentItem((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Item name"
                maxLength={100}
                autoComplete="off"
                autoCapitalize="sentences"
                aria-label="Item name"
                className="apple-input min-w-0 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItemToList();
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
                disabled={!currentItem.name.trim() || uploading}
                aria-label="Add item to list"
                className="apple-button flex h-12 w-12 shrink-0 items-center justify-center !p-0 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

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
