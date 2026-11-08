// Turn what someone typed (or dictated) into a list of items.
//
//   "3 bungee cords, tarp, 2 straps"  ->  3 x bungee cords, 1 x tarp, 2 x straps
//
// Pure and forgiving: splits on newlines, commas and semicolons (never on
// "and" - "nuts and bolts" is one item), reads a leading count ("3 tarps",
// "3x tarp", "3 x tarp") or a trailing count ("tarp x2", "tarp (2)"), and
// drops the full stop that dictation adds.
import { validateItemName } from "./validation";

export const MAX_PARSED_ITEMS = 50;
export const MAX_PARSED_QTY = 999;

// Newline, comma, semicolon - plus their full-width / ideographic cousins
const SEPARATORS = /[\r\n,;、，；]+/;
const TRAILING_PERIODS = /[.。\s]+$/;

// "1,000 screws" / "1,5 m cable": a comma BETWEEN two digits belongs to the
// number, not to the list. Swap those for a placeholder before splitting and
// put them back afterwards. (Lookahead only — older iPhones can't even parse
// regex lookbehind, which would blank the whole app.)
const NUMBER_COMMA = /(\d)([,，])(?=\d)/g;
const COMMA_MARK = "\u0000";
const COMMA_MARK_WIDE = "\u0001";
const shieldNumberCommas = (text) =>
  text.replace(NUMBER_COMMA, (_, digit, comma) =>
    digit + (comma === "," ? COMMA_MARK : COMMA_MARK_WIDE)
  );
const unshieldNumberCommas = (text) =>
  text.split(COMMA_MARK).join(",").split(COMMA_MARK_WIDE).join("，");

// "3x tarp", "3 x tarp", "3× tarp". The x must be followed by a space and then
// a non-digit: "2x4 lumber", "4 x 4 posts" are sizes, "3XL shirts" is a size.
const LEADING_X = /^(\d+)\s*[x×]\s+(\D.*)$/i;
// "3 bungee cords" (but "4 x 4 posts" is a size, not 4 of "x 4 posts")
const LEADING_PLAIN = /^(\d+)\s+(?![x×](?:\s|$))(.+)$/i;
// "tarp x2", "tarp x 2", "tarp × 2" - unless the name already ends in a
// number ("Plywood 4 x 8" is a size, not 8 of "Plywood 4")
const TRAILING_X = /^(.+?)\s+[x×]\s*(\d+)$/i;
// "tarp (2)"
const TRAILING_PAREN = /^(.+?)\s*\((\d+)\)$/;

const hasLetter = (s) => /\p{L}/u.test(s);
const validQty = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_PARSED_QTY;

/** Split one entry into { name, qty }. A "count" that isn't plausible
 *  (0, 2024 ...) is left in the name instead. */
function readCount(entry) {
  for (const re of [LEADING_X, LEADING_PLAIN]) {
    const m = entry.match(re);
    if (m && validQty(Number(m[1])) && hasLetter(m[2])) {
      return { name: m[2].trim(), qty: Number(m[1]) };
    }
  }
  const x = entry.match(TRAILING_X);
  if (x && validQty(Number(x[2])) && hasLetter(x[1]) && !/\d$/.test(x[1].trim())) {
    return { name: x[1].trim(), qty: Number(x[2]) };
  }
  const p = entry.match(TRAILING_PAREN);
  if (p && validQty(Number(p[2])) && hasLetter(p[1])) {
    return { name: p[1].trim(), qty: Number(p[2]) };
  }
  return { name: entry, qty: 1 };
}

/**
 * @param {string} text
 * @returns {{
 *   items:   {name: string, qty: number}[],   // valid, at most MAX_PARSED_ITEMS
 *   sources: string[],                        // sources[i] = the text items[i] came from
 *   skipped: {text: string, error: string}[], // entries whose name is invalid
 *   overflow: string[],                       // raw entries beyond the cap
 * }}
 */
export function parseItems(text) {
  const items = [];
  const sources = [];
  const skipped = [];
  const overflow = [];
  if (typeof text !== "string") return { items, sources, skipped, overflow };

  for (const raw of shieldNumberCommas(text).split(SEPARATORS)) {
    const entry = unshieldNumberCommas(raw).trim().replace(TRAILING_PERIODS, "").trim();
    if (!entry) continue;
    const { name, qty } = readCount(entry);
    const check = validateItemName(name);
    if (!check.valid) {
      skipped.push({ text: entry, error: check.error });
    } else if (items.length >= MAX_PARSED_ITEMS) {
      overflow.push(entry);
    } else {
      items.push({ name, qty });
      sources.push(entry);
    }
  }
  return { items, sources, skipped, overflow };
}

/** The text to leave in the box after adding: whatever could not be added. */
export const leftoverText = ({ skipped, overflow }) =>
  [...skipped.map((s) => s.text), ...overflow].join("\n");
