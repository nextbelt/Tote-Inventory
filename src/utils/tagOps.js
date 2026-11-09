// Tag edits as a DELTA, not a replacement (pure).
//
// The tag editor hands back a full list, but two phones may edit the same
// tote's tags within seconds of each other — and with patchy garage signal
// the store can be well behind the database. So an edit is described as
// what it added and removed against the list it opened on, and the service
// re-applies that delta to the tags as they are stored RIGHT NOW (read and
// compare-and-swap, like item ops). A tag the other phone added meanwhile
// survives; Undo is the same delta backwards.

import { normalizeTags } from "./validation";

const lowerTag = (tag) => tag.toLocaleLowerCase();

/** Same tags in the same order. */
export const sameTags = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * What changed between the list the editor opened on and the list it
 * returned. Compared by EXACT string, so fixing a tag's capitalization
 * ("xmas" → "Xmas") counts as a change: it removes the old spelling and
 * adds the new one. Case-insensitive matching happens in applyTagDelta.
 */
export const diffTags = (opened, next) => ({
  added: next.filter((t) => !opened.includes(t)),
  removed: opened.filter((t) => !next.includes(t)),
});

/** A delta with nothing in it. */
export const isEmptyDelta = (delta) =>
  !delta ||
  ((!Array.isArray(delta.added) || delta.added.length === 0) &&
    (!Array.isArray(delta.removed) || delta.removed.length === 0));

/**
 * `current` without `removed` (by case-insensitive key), then `added`;
 * normalizeTags keeps the FIRST spelling of a tag that appears twice, so a
 * tag the other phone already has (in any case) wins over our added copy.
 */
export const applyTagDelta = (current, { added = [], removed = [] } = {}) => {
  const gone = new Set(
    (Array.isArray(removed) ? removed : [])
      .filter((t) => typeof t === "string")
      .map(lowerTag)
  );
  return normalizeTags([
    ...normalizeTags(current).filter((t) => !gone.has(lowerTag(t))),
    ...(Array.isArray(added) ? added : []),
  ]);
};

/** The delta that undoes `delta`. */
export const invertTagDelta = ({ added = [], removed = [] } = {}) => ({
  added: removed,
  removed: added,
});
