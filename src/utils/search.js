// Forgiving search across totes and their items: partial words, minor
// misspellings, and singular/plural variants all match.

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Strip a simple English plural: totes→tote, boxes→boxe→box handled below. */
function singular(word) {
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Levenshtein distance capped at `max` (bails out early). */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** Does a single query token match any token of the target text? */
function tokenMatches(queryToken, targetTokens) {
  const q = singular(queryToken);
  return targetTokens.some((raw) => {
    const t = singular(raw);
    if (t.startsWith(q) || q.startsWith(t)) return true;
    if (raw.includes(queryToken)) return true;
    // Typo tolerance: 1 edit for medium words, 2 for long words
    if (q.length >= 4) {
      const max = q.length >= 7 ? 2 : 1;
      if (editDistance(q, t, max) <= max) return true;
    }
    return false;
  });
}

/** Every token of the query must match somewhere in the target text. */
export function fuzzyMatch(query, text) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  const targetTokens = tokenize(text);
  if (targetTokens.length === 0) return false;
  return queryTokens.every((q) => tokenMatches(q, targetTokens));
}

/**
 * Search totes and their items.
 * Returns a flat list of results sorted with item matches first (that's
 * usually what "where is my …" means), each carrying the owning tote.
 *   { type: "item", tote, item }  – an item inside a tote matched
 *   { type: "tote", tote }        – the tote name/position matched
 */
export function searchTotes(totes, query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const results = [];
  totes.forEach((tote) => {
    const items = Array.isArray(tote.items) ? tote.items : [];
    const matchedItems = items.filter((item) => fuzzyMatch(q, item.name));
    matchedItems.forEach((item) => results.push({ type: "item", tote, item }));

    const toteText = `${tote.name} ${tote.position}`;
    if (matchedItems.length === 0 && fuzzyMatch(q, toteText)) {
      results.push({ type: "tote", tote });
    }
  });

  return results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "item" ? -1 : 1;
    return 0;
  });
}
