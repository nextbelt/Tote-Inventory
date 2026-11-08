import { MAX_ITEM_NAME_LENGTH } from "../utils/constants";
import { MAX_PARSED_ITEMS } from "../utils/parseItems";

/**
 * Small line under the add box that says what Add will do when the text
 * holds several items, a quantity, or something that will be left out.
 * Renders nothing for a plain single item.
 */
export default function ParsePreview({ parsed, hasImage }) {
  const { items, skipped, overflow } = parsed;
  const multi = items.length > 1;
  const counted = items.length === 1 && items[0].qty > 1;
  if (!multi && !counted && skipped.length === 0 && overflow.length === 0) {
    return null;
  }
  const label = ({ name, qty }) => (qty > 1 ? `${qty} x ${name}` : name);
  return (
    <div
      className="mt-2 space-y-0.5 text-sm text-gray-500 dark:text-gray-400"
      data-testid="add-preview"
    >
      {(multi || counted) && (
        <p className="break-words">
          {multi ? `${items.length} items: ` : "Adds "}
          {items.map(label).join(", ")}
        </p>
      )}
      {multi && hasImage && (
        <p>The photo can only go on a single item, so it is not attached here.</p>
      )}
      {skipped.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          {skipped.length === 1 ? "1 entry is" : `${skipped.length} entries are`}{" "}
          over {MAX_ITEM_NAME_LENGTH} characters and will not be added.
        </p>
      )}
      {overflow.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          Only the first {MAX_PARSED_ITEMS} are added; {overflow.length} more
          stay in the box.
        </p>
      )}
    </div>
  );
}
