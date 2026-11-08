import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import Sheet from "./Sheet";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_TOTE,
  normalizeTags,
  validateTags,
} from "../utils/validation";

const sameTag = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * Edit one tote's tags in a bottom sheet: remove chips, type new ones
 * (several at once, comma-separated), or tap a suggestion — the tags the
 * household already uses on other totes, so spellings stay consistent.
 *
 * Save hands back the full normalized list; nothing is written here.
 *
 * Props:
 *   tags        – the tote's current tags (string[])
 *   suggestions – tags used on OTHER totes (string[]); ones already on this
 *                 tote are hidden
 *   onSave      – (tags) => void
 *   onClose     – cancel / dismiss
 */
export default function TagEditor({ tags, suggestions = [], onSave, onClose }) {
  const [list, setList] = useState(() => normalizeTags(tags));
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const inputId = useId();

  const remaining = suggestions.filter(
    (s) => typeof s === "string" && s.trim() && !list.some((t) => sameTag(t, s))
  );

  /** Add `raw` (one tag, or a comma-separated few) to the list, validated. */
  const add = (raw) => {
    const next = normalizeTags([...list, ...normalizeTags(raw)]);
    if (next.length === list.length) {
      // Nothing new (blank, or all duplicates): just clear the box
      setInput("");
      return true;
    }
    const check = validateTags(next);
    if (!check.valid) {
      setError(check.error);
      return false;
    }
    setError(null);
    setList(next);
    setInput("");
    return true;
  };

  const remove = (tag) => {
    setError(null);
    setList((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = () => {
    // A tag typed but not yet added counts too — people tap Save straight
    // after typing. If it is invalid the error shows and nothing is saved.
    if (input.trim()) {
      const next = normalizeTags([...list, ...normalizeTags(input)]);
      const check = validateTags(next);
      if (!check.valid) {
        setError(check.error);
        return;
      }
      onSave(next);
      return;
    }
    onSave(list);
  };

  const full = list.length >= MAX_TAGS_PER_TOTE;

  return (
    <Sheet title="Tags" onClose={onClose}>
      {list.length > 0 ? (
        <ul aria-label="Current tags" className="mb-3 flex flex-wrap gap-2">
          {list.map((tag) => (
            <li
              key={tag}
              className="flex items-center rounded-full bg-blue-50 pl-3 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="flex h-11 w-10 items-center justify-center rounded-full text-blue-500 dark:text-blue-400"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          No tags yet. Tags help you find totes by theme — “winter”, “kids”,
          “tools”.
        </p>
      )}

      <label
        htmlFor={inputId}
        className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300"
      >
        Add a tag
      </label>
      <div className="mb-1 flex gap-2">
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add(input);
            }
          }}
          disabled={full}
          placeholder={full ? `Up to ${MAX_TAGS_PER_TOTE} tags` : "e.g. winter, kids"}
          autoComplete="off"
          autoCapitalize="none"
          className="apple-input min-w-0 flex-1 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => add(input)}
          disabled={full || !input.trim()}
          aria-label="Add tag"
          className="apple-button flex h-12 w-12 shrink-0 items-center justify-center !p-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Up to {MAX_TAGS_PER_TOTE} tags, {MAX_TAG_LENGTH} characters each.
        Separate several with commas.
      </p>

      {remaining.length > 0 && !full && (
        <div className="mb-4">
          <p className="mb-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Already in use
          </p>
          <ul aria-label="Suggested tags" className="flex flex-wrap gap-2">
            {remaining.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => add(tag)}
                  className="flex min-h-[44px] items-center gap-1 rounded-full border border-gray-300 px-3 text-sm font-semibold text-gray-700 active:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:active:bg-gray-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-red-500">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
        <button type="button" onClick={handleSave} className="apple-button flex-1">
          Save
        </button>
      </div>
    </Sheet>
  );
}
