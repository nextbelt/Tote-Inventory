// Forgiving search across totes and their items: partial words, minor
// misspellings, and singular/plural variants all match, and results come back
// best match first.
//
// Per query word, the best-matching word of the target scores (see SCORE):
//   exact word > word prefix > singular/plural > substring > typo-tolerant
// Query words of 1-2 letters only ever match as a word prefix, so "a" or "to"
// can't match everything.

const SCORE = {
  exact: 100,
  prefix: 80,
  plural: 60,
  substring: 45,
  typo: 30,
};

const WORD_RE = /[\p{L}\p{N}]+/gu;
const SHORT_TOKEN = 2;

/** Lowercase and strip accents. */
function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC");
}

/** Words of `text` (Unicode letters/numbers) with their original positions. */
function wordsOf(text) {
  const source = String(text ?? "").normalize("NFC");
  const out = [];
  for (const m of source.matchAll(WORD_RE)) {
    const norm = normalize(m[0]);
    if (norm) out.push({ start: m.index, end: m.index + m[0].length, norm });
  }
  return { source, words: out };
}

function tokenize(text) {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Singular candidates for a simple English plural (boxes, batteries, totes). */
function stems(word) {
  const out = [word];
  if (word.length > 3 && word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
  if (word.length > 3 && word.endsWith("es")) out.push(word.slice(0, -2));
  if (word.length > 2 && word.endsWith("s")) out.push(word.slice(0, -1));
  return out;
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

/** How well one query word matches one target word (0 = no match). */
function wordScore(q, t) {
  if (q === t) return SCORE.exact;
  if (t.startsWith(q)) return SCORE.prefix;
  // 1-2 letter words must match at the start of a word, nothing fuzzier
  if (q.length <= SHORT_TOKEN) return 0;

  const qStems = stems(q);
  const tStems = stems(t);
  if (qStems.some((s) => s.length >= 2 && tStems.includes(s))) return SCORE.plural;
  if (tStems.some((s) => s !== t && s.startsWith(q))) return SCORE.prefix;
  if (q.length >= 3 && t.includes(q)) return SCORE.substring;

  // Typo tolerance: 1 edit for medium words, 2 for long words
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1;
    for (const qs of qStems) {
      for (const ts of tStems) {
        if (qs.length >= 4 && editDistance(qs, ts, max) <= max) return SCORE.typo;
      }
    }
  }
  return 0;
}

/**
 * Score `text` against the query words: 0 when any query word fails to match,
 * otherwise the average word score plus small bonuses for whole-name hits.
 */
function scoreText(queryTokens, text) {
  const targetTokens = tokenize(text);
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const t of targetTokens) {
      const s = wordScore(q, t);
      if (s > best) best = s;
      if (best === SCORE.exact) break;
    }
    if (best === 0) return 0;
    total += best;
  }
  let score = total / queryTokens.length;
  if (queryTokens.join(" ") === targetTokens.join(" ")) score += 10;
  else if (targetTokens.join(" ").startsWith(queryTokens.join(" "))) score += 5;
  // Shorter names are a tighter match for the same words
  score -= Math.min(targetTokens.length, 10) * 0.1;
  return score;
}

/** Every word of the query must match somewhere in the target text. */
export function fuzzyMatch(query, text) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  return scoreText(queryTokens, text) > 0;
}

/**
 * Split `text` into segments, flagging the words that matched the query so
 * the UI can bold them. Segments always concatenate back to the text.
 *   highlightMatches("Camping Gear", "gear") →
 *     [{ text: "Camping ", match: false }, { text: "Gear", match: true }]
 */
export function highlightMatches(text, query) {
  const queryTokens = tokenize(query);
  const { source, words } = wordsOf(text);
  if (queryTokens.length === 0 || words.length === 0) {
    return source ? [{ text: source, match: false }] : [];
  }
  const segments = [];
  let cursor = 0;
  const push = (end, match) => {
    if (end <= cursor) return;
    const piece = source.slice(cursor, end);
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += piece;
    else segments.push({ text: piece, match });
    cursor = end;
  };
  words.forEach((w) => {
    const matched = queryTokens.some((q) => wordScore(q, w.norm) > 0);
    push(w.start, false);
    push(w.end, matched);
  });
  push(source.length, false);
  return segments;
}

/**
 * Search totes and their items.
 * Returns a flat list sorted best match first (ties: items before totes, then
 * the original order), each carrying the owning tote and a numeric `score`.
 *   { type: "item", tote, item, score } – an item inside a tote matched
 *   { type: "tote", tote, score }       – the tote name/position matched
 * Tote matches are ranked alongside item matches. A query with no letters or
 * numbers (all punctuation) matches nothing.
 *
 * Notes and tags match too, but only when the name did not, and they always
 * rank below every name match. Those results carry
 * `match: { field: "note" | "notes" | "tag", text }` (the text that matched):
 *   item note  → { type: "item", ..., match.field "note" }
 *   tote notes → { type: "tote", ..., match.field "notes" }
 *   tote tag   → { type: "tote", ..., match.field "tag" }
 */
export function searchTotes(totes, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results = [];
  totes.forEach((tote) => {
    const items = Array.isArray(tote.items) ? tote.items : [];
    items.forEach((item) => {
      // Guard against malformed rows (a corrupt item must not crash the app)
      if (!item || typeof item !== "object") return;
      const score = scoreText(queryTokens, item.name);
      if (score > 0) {
        results.push({ type: "item", tote, item, score, tier: 0 });
        return;
      }
      const note = textOf(item.note);
      const noteScore = note ? scoreText(queryTokens, note) : 0;
      if (noteScore > 0) {
        results.push({
          type: "item",
          tote,
          item,
          score: noteScore,
          tier: 1,
          match: { field: "note", text: note },
        });
      }
    });

    const score = scoreText(queryTokens, `${tote.name} ${tote.position}`);
    if (score > 0) {
      results.push({ type: "tote", tote, score, tier: 0 });
      return;
    }

    // Tags: each tag on its own, so words of two different tags never combine
    let bestTag = null;
    let bestTagScore = 0;
    (Array.isArray(tote.tags) ? tote.tags : []).forEach((tag) => {
      const t = textOf(tag);
      const s = t ? scoreText(queryTokens, t) : 0;
      if (s > bestTagScore) {
        bestTagScore = s;
        bestTag = t;
      }
    });
    if (bestTagScore > 0) {
      results.push({
        type: "tote",
        tote,
        score: bestTagScore,
        tier: 1,
        match: { field: "tag", text: bestTag },
      });
      return;
    }
    const notes = textOf(tote.notes);
    const notesScore = notes ? scoreText(queryTokens, notes) : 0;
    if (notesScore > 0) {
      results.push({
        type: "tote",
        tote,
        score: notesScore,
        tier: 1,
        match: { field: "notes", text: notes },
      });
    }
  });

  return results
    .map((r, order) => ({ r, order }))
    .sort((a, b) => {
      if (a.r.tier !== b.r.tier) return a.r.tier - b.r.tier;
      if (b.r.score !== a.r.score) return b.r.score - a.r.score;
      if (a.r.type !== b.r.type) return a.r.type === "item" ? -1 : 1;
      return a.order - b.order;
    })
    .map(({ r: { tier, ...rest } }) => rest); // eslint-disable-line no-unused-vars
}

/** The text itself when it is a string, trimmed; else "". */
function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A short piece of `text` around the first word that matches the query, with
 * an ellipsis on a cut end. Short text comes back whole.
 */
export function snippetAround(text, query, max = 90) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (source.length <= max) return source;
  const queryTokens = tokenize(query);
  const { words } = wordsOf(source);
  const hit = words.find((w) => queryTokens.some((q) => wordScore(q, w.norm) > 0));
  const anchor = hit ? hit.start : 0;
  let from = Math.max(0, anchor - Math.floor(max / 3));
  // Start on a word boundary rather than mid-word
  if (from > 0) {
    const space = source.indexOf(" ", from);
    if (space !== -1 && space < anchor) from = space + 1;
  }
  const to = Math.min(source.length, from + max);
  return `${from > 0 ? "…" : ""}${source.slice(from, to).trim()}${to < source.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// "You already have one": is this item name already in another tote?
// ---------------------------------------------------------------------------

/**
 * True when two item names are the same thing: equal ignoring case, accents,
 * punctuation and spacing, with singular/plural treated as equal per word
 * ("Bungee cord" = "bungee  CORDS"). Word order matters; partial names don't
 * match ("Bungee" is not "Bungee cords").
 */
export function sameItemName(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || ta.length !== tb.length) return false;
  return ta.every((word, i) => {
    const other = tb[i];
    if (word === other) return true;
    const otherStems = stems(other);
    return stems(word).some((s) => s.length >= 2 && otherStems.includes(s));
  });
}

/**
 * Items elsewhere with the same name as `text`: [{ tote, item }], in tote
 * order, at most `limit` (default 2). Reserved "__" rows, the excluded tote
 * (compared by its original id type) and malformed items are skipped. Pass the
 * visible totes. Text under two letters/numbers matches nothing.
 */
export function findSimilarItems(totes, text, { excludeToteId, limit = 2 } = {}) {
  const key = tokenize(text).join("");
  if (key.length < 2 || !Array.isArray(totes) || limit <= 0) return [];
  const out = [];
  for (const tote of totes) {
    if (!tote || typeof tote !== "object") continue;
    if (typeof tote.position === "string" && tote.position.startsWith("__")) continue;
    if (excludeToteId !== undefined && excludeToteId !== null && tote.id === excludeToteId) {
      continue;
    }
    for (const item of Array.isArray(tote.items) ? tote.items : []) {
      if (!item || typeof item !== "object") continue;
      if (sameItemName(item.name, text)) {
        out.push({ tote, item });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
