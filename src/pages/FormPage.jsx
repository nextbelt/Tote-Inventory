import { Camera, ChevronLeft, Plus, Save, X } from "lucide-react";
import { useState } from "react";
import { useTotes } from "../hooks/useTotes";
import { toteService } from "../services/toteService";
import {
  validateImageFile,
  validateItemName,
  validateToteName,
} from "../utils/validation";

export default function FormPage({ editTote, position, onBack, onSaved }) {
  const { saveTote } = useTotes();

  const [toteName, setToteName] = useState(editTote?.name || "");
  const [items, setItems] = useState(editTote?.items || []);
  const [currentItem, setCurrentItem] = useState({ name: "", image: null });
  const [saving, setSaving] = useState(false);

  const isEditing = !!editTote;

  // ------ Image upload ------
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    try {
      const fileName = `${Date.now()}-${file.name}`;
      const imageUrl = await toteService.uploadImage(file, fileName);
      setCurrentItem((prev) => ({ ...prev, image: imageUrl }));
    } catch {
      alert("Failed to upload image. Please try again.");
    }
  };

  // ------ Item list management ------
  const addItemToList = () => {
    const validation = validateItemName(currentItem.name);
    if (!validation.valid) return;

    setItems((prev) => [
      ...prev,
      { ...currentItem, name: currentItem.name.trim(), id: Date.now() },
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
      alert(nameCheck.error);
      return;
    }
    if (!position) {
      alert("Position is required.");
      return;
    }

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
    } catch {
      alert("Failed to save tote. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ------ Render ------
  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
      }}
    >
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="apple-card p-4 sm:p-6 md:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            <button
              onClick={onBack}
              className="flex items-center text-blue-600 hover:text-blue-700 transition-colors duration-200 group"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 mr-1 group-hover:-translate-x-1 transition-transform duration-200" />
              <span className="text-sm sm:text-base font-medium">
                Back to Grid
              </span>
            </button>
            <h1 className="apple-subtitle text-lg sm:text-xl md:text-2xl">
              {isEditing ? "Edit Tote" : "New Tote"}
            </h1>
            <div className="w-16 sm:w-20 md:w-24" />
          </div>

          <div className="space-y-6 sm:space-y-8">
            {/* Tote name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 sm:mb-3">
                Tote Name
              </label>
              <input
                type="text"
                value={toteName}
                onChange={(e) => setToteName(e.target.value)}
                placeholder="e.g., Holiday Decorations"
                maxLength={100}
                className="apple-input w-full"
              />
            </div>

            {/* Position (read-only) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 sm:mb-3">
                Selected Position
              </label>
              <div className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-blue-50 border border-blue-200 rounded-xl sm:rounded-2xl text-blue-800 font-semibold text-sm sm:text-base">
                {position || "No position selected"}
              </div>
            </div>

            {/* Add items section */}
            <div className="border-t border-gray-700/50 pt-6 sm:pt-8">
              <h3 className="apple-subtitle text-lg sm:text-xl mb-4 sm:mb-6">
                Add Items
              </h3>
              <div className="space-y-4 sm:space-y-6">
                <input
                  type="text"
                  value={currentItem.name}
                  onChange={(e) =>
                    setCurrentItem((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Item name"
                  maxLength={100}
                  className="apple-input w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addItemToList();
                  }}
                />

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <label className="flex-1 cursor-pointer group">
                    <div className="flex items-center justify-center px-4 sm:px-6 py-3 sm:py-4 border-2 border-dashed border-gray-300 rounded-xl sm:rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 group-hover:scale-105">
                      <Camera className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3 text-blue-600 group-hover:text-blue-700" />
                      <span className="text-xs sm:text-sm text-gray-500 group-hover:text-blue-700">
                        {currentItem.image ? "Change Photo" : "Add Photo"}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={addItemToList}
                    disabled={!currentItem.name.trim()}
                    className="apple-button px-6 sm:px-8 py-3 sm:py-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-sm sm:text-base"
                  >
                    <Plus className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    Add
                  </button>
                </div>

                {currentItem.image && (
                  <div className="flex justify-center">
                    <img
                      src={currentItem.image}
                      alt="Preview"
                      className="w-32 h-32 sm:w-40 sm:h-40 object-cover rounded-xl sm:rounded-2xl border border-gray-300 shadow-lg"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Items list */}
            {items.length > 0 && (
              <div className="border-t border-gray-200 pt-6 sm:pt-8">
                <h3 className="apple-subtitle text-lg sm:text-xl mb-4 sm:mb-6">
                  Items ({items.length})
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-white border border-gray-200 rounded-xl sm:rounded-2xl shadow-sm"
                    >
                      {item.image && (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg sm:rounded-xl border border-gray-300"
                        />
                      )}
                      <span className="flex-1 font-semibold text-gray-800 text-sm sm:text-base">
                        {item.name}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-2 sm:p-3 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg sm:rounded-xl transition-all duration-200"
                      >
                        <X className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!toteName.trim() || !position || saving}
              className="apple-button w-full py-4 sm:py-5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-sm sm:text-base"
            >
              <Save className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
              {saving ? "Saving…" : isEditing ? "Update Tote" : "Save Tote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
