import { supabase } from "../lib/supabase";
import { compressImage } from "../utils/images";
import {
  addItem,
  composeOps,
  normalizeItems,
  removeItem,
  setItemImage,
} from "../utils/itemOps";
import { dataUriToBlob, findEmbeddedPhotos, stripForCache } from "../utils/maintenance";
import {
  CONFIG_POSITION,
  REMOVED_ITEMS_POSITION,
  RESERVED_PREFIX,
  appendRemovedEntries,
  isExpired,
  isReservedPosition,
  isTombstonePosition,
  makeRemovedEntries,
  parseTombstone,
  removedEntriesFromRows,
  toDeletedEntry,
  tombstonePosition,
} from "../utils/reservedRows";
import {
  normalizeNotes,
  normalizeTags,
  validateNotes,
  validateTags,
} from "../utils/validation";

// ---------------------------------------------------------------------------
// Storage model
//
//   cloud mode (Supabase configured):
//     - reads:  Supabase → mirrored to a local cache for offline browsing
//     - writes: Supabase only. Failures THROW with a friendly message —
//       we never silently write to localStorage, because those "shadow"
//       totes would look saved but never sync to other devices.
//   local mode (no Supabase env vars):
//     - everything lives in localStorage under LOCAL_STORE_KEY.
// ---------------------------------------------------------------------------

const LOCAL_STORE_KEY = "totes-inventory"; // local-mode store (legacy key)
const CACHE_KEY = "totes-cache"; // read-only mirror of cloud data
const LOCAL_LAYOUT_KEY = "garage-layout"; // local-mode layout settings

// In cloud mode the layout settings live in a hidden row of the totes table
// (no extra table → works on the existing database, syncs via realtime).
// Every reserved row kind is defined in utils/reservedRows.
export { CONFIG_POSITION, REMOVED_ITEMS_POSITION };

/**
 * Split raw rows into real totes and the reserved "__" rows: the newest
 * layout-settings row, soft-deleted tombstones (as "recently deleted"
 * entries, newest first) and the removed-items bin row(s). ANY position
 * starting with "__" is kept out of `totes`, so a reserved row can never
 * show up on a wall.
 */
export function splitConfig(rows) {
  const totes = [];
  const deleted = [];
  const removedRows = [];
  let config = null;
  (rows || []).forEach((row) => {
    if (!row) return;
    if (!isReservedPosition(row.position)) {
      totes.push(row);
      return;
    }
    if (row.position === CONFIG_POSITION) {
      if (
        !config ||
        new Date(row.updated_at || 0) > new Date(config.updated_at || 0)
      ) {
        config = row;
      }
    } else if (row.position === REMOVED_ITEMS_POSITION) {
      removedRows.push(row);
    } else {
      const entry = toDeletedEntry(row);
      if (entry) deleted.push(entry);
      // any other "__" row is reserved for the future → hidden
    }
  });
  deleted.sort(
    (a, b) =>
      new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime()
  );
  const layout =
    config && config.items && !Array.isArray(config.items)
      ? config.items
      : null;
  return { totes, layout, configRow: config, deleted, removedRows };
}

// ---------------------------------------------------------------------------
// Capabilities — which optional database features are present.
//
// Tags, notes and the swap function arrive together in one SQL script the
// owners paste once (MAINTENANCE.md). Until then the app must keep working:
// we detect the columns from the rows select("*") returns and refuse to
// send unknown columns (PostgREST would reject the whole write).
// ---------------------------------------------------------------------------

export const ALL_CAPABILITIES = Object.freeze({ tags: true, notes: true, swap: true });
export const NO_CAPABILITIES = Object.freeze({ tags: false, notes: false, swap: false });

export const SETUP_NEEDED_MESSAGE =
  'One-time setup needed: run the SQL in MAINTENANCE.md ("One-time setup: tags, notes and swap").';

/** Capabilities implied by a set of rows (cloud or cached). Local mode: all. */
export function detectCapabilities(rows) {
  if (!supabase) return { ...ALL_CAPABILITIES };
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const has = (key) =>
    list.length > 0 &&
    list.some((row) => Object.prototype.hasOwnProperty.call(row, key));
  const tags = has("tags");
  const notes = has("notes");
  // The migration adds all three together; the function has no column to
  // sniff, so it is inferred from the columns.
  return { tags, notes, swap: tags && notes };
}

// Last capabilities seen by getTotes (null until the first load).
let knownCapabilities = null;

/** Throw the setup error when the cloud database is known to lack `name`. */
function assertCapability(name) {
  if (!supabase) return;
  if (knownCapabilities && knownCapabilities[name] === false) {
    throw new UserFacingError(SETUP_NEEDED_MESSAGE, { code: "SETUP_NEEDED" });
  }
}

/** Supabase/PostgREST errors that mean "the SQL script hasn't been run". */
function isMissingSchemaError(err) {
  const code = err?.code;
  if (code === "PGRST202" || code === "PGRST204") return true; // function / column not in schema cache
  if (code === "42703" || code === "42883") return true; // undefined column / function
  return /could not find the (function|'?\w+'? column)/i.test(err?.message || "");
}

export const storageMode = supabase ? "cloud" : "local";

function readJSON(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be full or unavailable — silently degrade
  }
}

const getLocalTotes = () => readJSON(LOCAL_STORE_KEY);
const saveLocalTotes = (totes) => writeJSON(LOCAL_STORE_KEY, totes);

// Writes to the same tote are serialized so two in-flight saves (e.g. a
// debounced item edit racing a move) can never finish out of order and
// clobber each other's fields.
const writeQueues = new Map();
function enqueueWrite(key, task) {
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  writeQueues.set(
    key,
    next.catch(() => {})
  );
  return next;
}

// Compare-and-swap item writes re-read and retry this many times when the
// other phone wrote first (each retry re-applies the same idempotent op).
const CAS_ATTEMPTS = 3;

/**
 * Fresh updated_at that is strictly later than the one we read. Guards the
 * compare-and-swap against clock skew between phones: if the stamp didn't
 * move, the other device's stale match could still succeed and clobber us.
 */
function nextStamp(previous) {
  const now = Date.now();
  const prev = previous ? new Date(previous).getTime() : NaN;
  const stamp = Number.isFinite(prev) && prev >= now ? prev + 1 : now;
  return new Date(stamp).toISOString();
}

/**
 * An error whose message is already written for the user — never rewrapped.
 * `code` lets callers branch without string-matching:
 *   SETUP_NEEDED   the SQL script in MAINTENANCE.md hasn't been run
 *   NO_TOMBSTONE   nothing to restore (already purged or never soft-deleted)
 *   SLOT_TAKEN     the spot to restore into is occupied — offer a picker
 *   TOTE_GONE      the tote a removed item came from no longer exists
 */
export class UserFacingError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "UserFacingError";
    if (code) this.code = code;
  }
}

const NOT_FOUND_MESSAGE = "Couldn't find that tote to update.";
const BUSY_MESSAGE =
  "Someone else is editing this tote right now. Please try again in a moment.";
const slotTakenError = (position) =>
  new UserFacingError(
    `Spot ${position} is taken now. Pick an empty spot to put the tote back.`,
    { code: "SLOT_TAKEN" }
  );

/** Convert Supabase/network failures into messages a person can act on. */
function friendlyError(err, action) {
  if (err instanceof UserFacingError) return err;
  if (isMissingSchemaError(err)) {
    return new UserFacingError(SETUP_NEEDED_MESSAGE, { code: "SETUP_NEEDED" });
  }
  if (err?.code === "23505") {
    return new Error(
      "That spot already has a tote. Pick a different position."
    );
  }
  if (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    err?.message === "Failed to fetch" ||
    err?.name === "TypeError"
  ) {
    return new Error(
      `You look offline — the ${action} wasn't saved. Try again when you're back online.`
    );
  }
  return new Error(`Couldn't ${action}. Please try again.`);
}

// ---------------------------------------------------------------------------
// One-time migration: localStorage → Supabase
// ---------------------------------------------------------------------------

export async function migrateLocalToSupabase() {
  if (!supabase) return;

  // Skip if already migrated
  const migrated = localStorage.getItem("totes-migration-done");
  if (migrated) return;

  const localTotes = getLocalTotes();
  if (localTotes.length === 0) {
    localStorage.setItem("totes-migration-done", "true");
    return;
  }

  try {
    // Fetch existing totes from Supabase to avoid duplicates
    const { data: existing, error: fetchErr } = await supabase
      .from("totes")
      .select("position, name");
    if (fetchErr) throw fetchErr;

    const existingKeys = new Set(
      (existing || []).map((t) => `${t.position}::${t.name}`)
    );

    const toInsert = localTotes
      .filter((t) => !existingKeys.has(`${t.position}::${t.name}`))
      .map((t) => ({
        name: (t.name || "").trim(),
        position: t.position,
        items: Array.isArray(t.items) ? t.items : [],
        created_at: t.created_at || new Date().toISOString(),
        updated_at: t.updated_at || new Date().toISOString(),
      }));

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("totes")
        .insert(toInsert);
      if (insertErr) throw insertErr;
    }

    localStorage.setItem("totes-migration-done", "true");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "localStorage → Supabase migration failed, will retry next load:",
      err
    );
    // Don't mark as done — will retry on next page load
  }
}

// ---------------------------------------------------------------------------
// Removed-items bin helpers
// ---------------------------------------------------------------------------

const REMOVED_ITEMS_NAME = "Removed items (app bin)";

// Id of the bin row once known (per page load) — saves a lookup per append.
let removedRowId = null;

/**
 * Find or create the bin row. Serialized under the bin position so two
 * removals on this phone can't both insert; if the OTHER phone inserted
 * first the unique violation makes us re-read and use its row. When the row
 * is created here `entries` go in with it (no second write needed).
 * @returns {{ id, created: boolean, row?: object }}
 */
function ensureRemovedItemsRow(entries) {
  return enqueueWrite(REMOVED_ITEMS_POSITION, async () => {
    if (removedRowId !== null) return { id: removedRowId, created: false };
    const stamp = new Date().toISOString();
    const fresh = {
      name: REMOVED_ITEMS_NAME,
      position: REMOVED_ITEMS_POSITION,
      items: appendRemovedEntries(entries)([]),
      created_at: stamp,
      updated_at: stamp,
    };

    // ---------- local mode ----------
    if (!supabase) {
      const totes = getLocalTotes();
      const existing = totes.find((t) => t.position === REMOVED_ITEMS_POSITION);
      if (existing) {
        removedRowId = existing.id;
        return { id: existing.id, created: false };
      }
      const row = { ...fresh, id: Date.now() };
      totes.push(row);
      saveLocalTotes(totes);
      removedRowId = row.id;
      return { id: row.id, created: true, row };
    }

    // ---------- cloud mode ----------
    const findExisting = async () => {
      const { data, error } = await supabase
        .from("totes")
        .select("id")
        .eq("position", REMOVED_ITEMS_POSITION)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0 ? data[0].id : null;
    };
    try {
      let id = await findExisting();
      if (id !== null) {
        removedRowId = id;
        return { id, created: false };
      }
      const { data, error } = await supabase
        .from("totes")
        .insert(fresh)
        .select()
        .single();
      if (error) {
        if (error.code !== "23505") throw error;
        // Lost the create race to the other phone — use its row
        id = await findExisting();
        if (id === null) throw error;
        removedRowId = id;
        return { id, created: false };
      }
      removedRowId = data.id;
      return { id: data.id, created: true, row: data };
    } catch (err) {
      throw friendlyError(err, "save the removed item");
    }
  });
}

/** Every bin row (the live table may hold more than one). Cloud falls back
 *  to the offline cache so the bin can still be browsed without signal. */
async function readRemovedItemsRows() {
  if (!supabase) {
    return getLocalTotes().filter((t) => t.position === REMOVED_ITEMS_POSITION);
  }
  try {
    const { data, error } = await supabase
      .from("totes")
      .select("*")
      .eq("position", REMOVED_ITEMS_POSITION);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch {
    return readJSON(CACHE_KEY).filter(
      (t) => t?.position === REMOVED_ITEMS_POSITION
    );
  }
}

/** True when a tote with this id exists and is not a reserved row. */
async function isLiveTote(id) {
  if (!supabase) {
    const tote = getLocalTotes().find((t) => t.id === id);
    return Boolean(tote) && !isReservedPosition(tote.position);
  }
  try {
    const { data, error } = await supabase
      .from("totes")
      .select("id, position")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data) && !isReservedPosition(data.position);
  } catch (err) {
    throw friendlyError(err, "find the tote");
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const toteService = {
  /**
   * Return all totes, where they came from, the saved layout settings, the
   * recently deleted totes and the database capabilities:
   *   { data, source: "cloud" | "cache" | "local", layout | null,
   *     deleted: [{ id, name, originalPosition, deletedAt, items }],
   *     capabilities: { tags, notes, swap } }
   * "cache" means the cloud is unreachable and this is the last-known copy.
   * Tombstones older than 30 days are purged here, best effort.
   */
  async getTotes() {
    if (!supabase) {
      const layout = (() => {
        try {
          return JSON.parse(localStorage.getItem(LOCAL_LAYOUT_KEY)) || null;
        } catch {
          return null;
        }
      })();
      const rows = getLocalTotes();
      const kept = rows.filter(
        (row) => !(isTombstonePosition(row?.position) && isExpired(row.updated_at))
      );
      if (kept.length !== rows.length) saveLocalTotes(kept);
      const { totes, deleted } = splitConfig(kept);
      return {
        data: totes,
        source: "local",
        layout,
        deleted,
        capabilities: { ...ALL_CAPABILITIES },
      };
    }

    try {
      const { data, error } = await supabase
        .from("totes")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // Strip embedded photos so a multi-MB legacy row can't overflow
      // the localStorage quota and silently kill offline browsing
      writeJSON(CACHE_KEY, stripForCache(data || []));
      const capabilities = detectCapabilities(data);
      knownCapabilities = capabilities;
      const { totes, layout, deleted } = splitConfig(data);
      // Best-effort 30-day purge: fire and forget, never blocks the load.
      // The delete triggers a realtime reload, which then finds nothing old.
      const expired = deleted.filter((d) => isExpired(d.deletedAt));
      expired.forEach((d) => {
        toteService.purgeDeletedTote(d.id).catch(() => {});
      });
      return {
        data: totes,
        source: "cloud",
        layout,
        deleted: deleted.filter((d) => !isExpired(d.deletedAt)),
        capabilities,
      };
    } catch {
      const cached = readJSON(CACHE_KEY);
      const { totes, layout, deleted } = splitConfig(cached);
      return {
        data: totes,
        source: "cache",
        layout,
        deleted,
        capabilities: detectCapabilities(cached),
      };
    }
  },

  /**
   * Persist the garage layout settings (side-wall shelf counts).
   * Cloud mode upserts the hidden settings row; other devices pick the
   * change up through the existing realtime subscription.
   */
  async saveLayout(layout) {
    if (!supabase) {
      try {
        localStorage.setItem(LOCAL_LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // storage full — settings just won't persist
      }
      return layout;
    }

    return enqueueWrite(CONFIG_POSITION, async () => {
      try {
        const { data, error } = await supabase
          .from("totes")
          .select("id")
          .eq("position", CONFIG_POSITION)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (error) throw error;

        const row = {
          items: layout,
          updated_at: new Date().toISOString(),
        };
        if (data && data.length > 0) {
          const { error: updErr } = await supabase
            .from("totes")
            .update(row)
            .eq("id", data[0].id);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase.from("totes").insert({
            ...row,
            name: "Garage layout (app settings)",
            position: CONFIG_POSITION,
            created_at: new Date().toISOString(),
          });
          if (insErr) throw insErr;
        }
        return layout;
      } catch (err) {
        throw friendlyError(err, "save the shelf layout");
      }
    });
  },

  /**
   * Patch specific fields of a tote (subset of name/position/items/tags/notes).
   * Field-level patches mean an item edit can never clobber a concurrent
   * move (and vice versa); per-tote queueing keeps writes ordered.
   * Tags/notes are normalized + validated here; in cloud mode they throw the
   * setup error (and send nothing) until the database has the columns.
   * @throws {Error} in cloud mode when the write fails (never shadow-saves)
   */
  async updateTote(id, fields) {
    const patch = { ...fields, updated_at: new Date().toISOString() };
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.items !== undefined && !Array.isArray(patch.items)) {
      patch.items = [];
    }
    if (patch.position !== undefined && isReservedPosition(patch.position)) {
      throw new UserFacingError("That spot can't be used for a tote.");
    }
    if (patch.tags !== undefined) {
      assertCapability("tags");
      patch.tags = normalizeTags(patch.tags);
      const check = validateTags(patch.tags);
      if (!check.valid) throw new UserFacingError(check.error);
    }
    if (patch.notes !== undefined) {
      assertCapability("notes");
      patch.notes = normalizeNotes(patch.notes);
      const check = validateNotes(patch.notes);
      if (!check.valid) throw new UserFacingError(check.error);
    }

    return enqueueWrite(id, async () => {
      // ---------- local mode ----------
      if (!supabase) {
        const totes = getLocalTotes();
        const idx = totes.findIndex((t) => t.id === id);
        // A reserved row (soft-deleted tombstone, settings, bin) is not a
        // tote: patching it would quietly undelete / corrupt it.
        if (idx < 0 || isReservedPosition(totes[idx].position)) {
          throw new UserFacingError(NOT_FOUND_MESSAGE);
        }
        totes[idx] = { ...totes[idx], ...patch };
        saveLocalTotes(totes);
        return totes[idx];
      }

      // ---------- cloud mode ----------
      // The reserved-position filter is part of the write, so a rename or
      // move from a page opened before the other phone deleted this tote
      // can never revive the tombstone (and skip the slot check). Reads
      // the row count instead of .single() so "no row" is reported as
      // "couldn't find", exactly as before soft delete.
      try {
        const { data, error } = await supabase
          .from("totes")
          .update(patch)
          .eq("id", id)
          .not("position", "match", `^${RESERVED_PREFIX}`)
          .select();
        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) {
          throw new UserFacingError(NOT_FOUND_MESSAGE);
        }
        return data[0];
      } catch (err) {
        throw friendlyError(err, "save your changes");
      }
    });
  },

  /**
   * Change a tote's items by applying a pure operation (see utils/itemOps)
   * to the FRESHEST stored copy — never by writing a snapshot. Two phones
   * editing the same tote therefore both keep their changes.
   *
   * Cloud mode is a compare-and-swap: read items + updated_at, apply the op,
   * then UPDATE only if updated_at still matches what was read. If another
   * device won the race no row comes back, so we re-read and re-apply (the
   * ops are idempotent), giving up after a few attempts.
   *
   * @param {number|string} id
   * @param {(items: object[]) => object[]} mutate  pure, idempotent
   * @returns the saved row
   * @throws {Error} friendly message on failure (never shadow-saves)
   */
  async updateItems(id, mutate) {
    if (typeof mutate !== "function") {
      throw new TypeError("updateItems needs an operation function");
    }

    return enqueueWrite(id, async () => {
      // ---------- local mode ----------
      if (!supabase) {
        const totes = getLocalTotes();
        const idx = totes.findIndex((t) => t.id === id);
        if (idx < 0) throw new UserFacingError(NOT_FOUND_MESSAGE);
        const current = Array.isArray(totes[idx].items) ? totes[idx].items : [];
        totes[idx] = {
          ...totes[idx],
          items: normalizeItems(mutate(current)),
          updated_at: new Date().toISOString(),
        };
        saveLocalTotes(totes);
        return totes[idx];
      }

      // ---------- cloud mode (compare-and-swap) ----------
      try {
        for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
          const { data: row, error: readErr } = await supabase
            .from("totes")
            .select("items, updated_at")
            .eq("id", id)
            .maybeSingle();
          if (readErr) throw readErr;
          if (!row) throw new UserFacingError(NOT_FOUND_MESSAGE);

          const current = Array.isArray(row.items) ? row.items : [];
          const patch = {
            items: normalizeItems(mutate(current)),
            updated_at: nextStamp(row.updated_at),
          };

          let query = supabase.from("totes").update(patch).eq("id", id);
          // Only land if nobody else wrote since we read
          query =
            row.updated_at === null || row.updated_at === undefined
              ? query.is("updated_at", null)
              : query.eq("updated_at", row.updated_at);
          const { data, error } = await query.select();
          if (error) throw error;
          if (Array.isArray(data) && data.length > 0) return data[0];
          // Lost the race — loop re-reads the other phone's copy and
          // re-applies the same op on top of it.
        }
        throw new UserFacingError(
          "Someone else is editing this tote right now. Please try again in a moment."
        );
      } catch (err) {
        throw friendlyError(err, "save your changes");
      }
    });
  },

  /**
   * Create or update a tote.
   * @param {object}  tote   – tote data (must include `id` for updates)
   * @param {boolean} isNew  – true → INSERT, false → UPDATE
   * @throws {Error} in cloud mode when the write fails (never shadow-saves)
   *
   * NOTE: the update path (isNew = false) writes name, position AND the
   * whole items array from the caller's copy. App code no longer uses it —
   * prefer updateTote() for name/position and updateItems() for items so a
   * stale snapshot can never erase the other phone's edits.
   */
  async saveTote(tote, isNew = false) {
    if (!isNew) {
      return this.updateTote(tote.id, {
        name: tote.name,
        position: tote.position,
        items: tote.items,
      });
    }

    if (isReservedPosition(tote.position)) {
      throw new UserFacingError("That spot can't be used for a tote.");
    }

    const toteData = {
      name: tote.name.trim(),
      position: tote.position,
      items: Array.isArray(tote.items) ? tote.items : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Optional columns: only sent when given AND the database has them
    if (tote.tags !== undefined) {
      assertCapability("tags");
      toteData.tags = normalizeTags(tote.tags);
      const check = validateTags(toteData.tags);
      if (!check.valid) throw new UserFacingError(check.error);
    }
    if (tote.notes !== undefined) {
      assertCapability("notes");
      toteData.notes = normalizeNotes(tote.notes);
      const check = validateNotes(toteData.notes);
      if (!check.valid) throw new UserFacingError(check.error);
    }

    // ---------- local mode ----------
    if (!supabase) {
      const totes = getLocalTotes();
      if (totes.some((t) => t.position === tote.position)) {
        throw new Error(
          "That spot already has a tote. Pick a different position."
        );
      }
      const localTote = {
        tags: [],
        notes: null,
        ...toteData,
        id: Date.now(),
      };
      totes.push(localTote);
      saveLocalTotes(totes);
      return localTote;
    }

    // ---------- cloud mode ----------
    try {
      const { data, error } = await supabase
        .from("totes")
        .insert(toteData)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      throw friendlyError(err, "save the tote");
    }
  },

  /**
   * Soft-delete a tote: move the row to a reserved tombstone position
   * ("__deleted__:<position>:<id>", unique per tote) and stamp updated_at as
   * the deleted time. The slot frees immediately, the row keeps its id,
   * items and created_at, and it can be restored for 30 days (then
   * getTotes purges it). Deleting an already-deleted or unknown tote is a
   * no-op.
   * @returns the "recently deleted" entry, or null when there was nothing
   * @throws {Error} in cloud mode when the write fails
   */
  async deleteTote(id) {
    return enqueueWrite(id, async () => {
      const stamp = new Date().toISOString();

      // ---------- local mode ----------
      if (!supabase) {
        const totes = getLocalTotes();
        const idx = totes.findIndex((t) => t.id === id);
        if (idx < 0) return null;
        if (isReservedPosition(totes[idx].position)) {
          return toDeletedEntry(totes[idx]); // already a tombstone (or not a tote)
        }
        totes[idx] = {
          ...totes[idx],
          position: tombstonePosition(totes[idx].position, id),
          updated_at: stamp,
        };
        saveLocalTotes(totes);
        return toDeletedEntry(totes[idx]);
      }

      // ---------- cloud mode ----------
      // The position we read is part of the write condition, so a move made
      // on the other phone in between is never recorded as the wrong
      // original slot (we simply re-read and try again).
      try {
        for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
          const { data: row, error: readErr } = await supabase
            .from("totes")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (readErr) throw readErr;
          if (!row) return null;
          if (isReservedPosition(row.position)) return toDeletedEntry(row);

          const patch = {
            position: tombstonePosition(row.position, id),
            updated_at: nextStamp(row.updated_at),
          };
          const { data, error } = await supabase
            .from("totes")
            .update(patch)
            .eq("id", id)
            .eq("position", row.position)
            .select();
          if (error) throw error;
          if (Array.isArray(data) && data.length > 0) {
            return toDeletedEntry(data[0]);
          }
        }
        throw new UserFacingError(BUSY_MESSAGE);
      } catch (err) {
        throw friendlyError(err, "delete the tote");
      }
    });
  },

  /**
   * Put a soft-deleted tote back: to its original spot when that is free,
   * otherwise to `targetPosition` (must be free) — with no free target the
   * SLOT_TAKEN error asks the caller to pick one. Keeps id and created_at.
   * Restoring a tote that is already live just returns it.
   * @throws {UserFacingError} NO_TOMBSTONE when there is nothing to restore
   */
  async restoreDeletedTote(id, targetPosition) {
    return enqueueWrite(id, async () => {
      const stamp = new Date().toISOString();
      let target = targetPosition || null; // resolved from the tombstone below
      const gone = () =>
        new UserFacingError("That tote is no longer in Recently deleted.", {
          code: "NO_TOMBSTONE",
        });
      const pickTarget = (row) => {
        const parsed = parseTombstone(row.position);
        if (!parsed) {
          if (isReservedPosition(row.position)) throw gone(); // not a tote
          return null; // already live
        }
        target = targetPosition || parsed.originalPosition;
        if (!target || isReservedPosition(target)) {
          throw new UserFacingError("Pick an empty spot to put the tote back.");
        }
        return target;
      };

      // ---------- local mode ----------
      if (!supabase) {
        const totes = getLocalTotes();
        const idx = totes.findIndex((t) => t.id === id);
        if (idx < 0) throw gone();
        if (pickTarget(totes[idx]) === null) return totes[idx];
        if (totes.some((t) => t.id !== id && t.position === target)) {
          throw slotTakenError(target);
        }
        totes[idx] = { ...totes[idx], position: target, updated_at: stamp };
        saveLocalTotes(totes);
        return totes[idx];
      }

      // ---------- cloud mode ----------
      try {
        const { data: row, error: readErr } = await supabase
          .from("totes")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (readErr) throw readErr;
        if (!row) throw gone();
        if (pickTarget(row) === null) return row;

        // The live table may lack UNIQUE(position): check before writing.
        const { data: occupied, error: occErr } = await supabase
          .from("totes")
          .select("id")
          .eq("position", target)
          .limit(1);
        if (occErr) throw occErr;
        if (Array.isArray(occupied) && occupied.length > 0) {
          throw slotTakenError(target);
        }

        const { data, error } = await supabase
          .from("totes")
          .update({ position: target, updated_at: nextStamp(row.updated_at) })
          .eq("id", id)
          .eq("position", row.position)
          .select();
        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) return data[0];

        // The other phone restored or purged it meanwhile — report the truth
        const { data: now, error: reErr } = await supabase
          .from("totes")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (reErr) throw reErr;
        if (now && !isReservedPosition(now.position)) return now;
        throw gone();
      } catch (err) {
        if (err?.code === "23505") throw slotTakenError(target || "");
        throw friendlyError(err, "restore the tote");
      }
    });
  },

  /**
   * Permanently remove a soft-deleted tote. Only ever deletes a row that is
   * still a tombstone — a tote restored on the other phone is left alone.
   */
  async purgeDeletedTote(id) {
    return enqueueWrite(id, async () => {
      if (!supabase) {
        saveLocalTotes(
          getLocalTotes().filter(
            (t) => !(t.id === id && isTombstonePosition(t.position))
          )
        );
        return;
      }
      try {
        const { data: row, error: readErr } = await supabase
          .from("totes")
          .select("position")
          .eq("id", id)
          .maybeSingle();
        if (readErr) throw readErr;
        if (!row || !isTombstonePosition(row.position)) return;
        const { error } = await supabase
          .from("totes")
          .delete()
          .eq("id", id)
          .eq("position", row.position);
        if (error) throw error;
      } catch (err) {
        throw friendlyError(err, "remove the tote for good");
      }
    });
  },

  /**
   * Swap the positions of two totes in one step. Cloud mode calls the
   * swap_tote_positions() database function (one transaction, UNIQUE-safe);
   * until the SQL script has been run this throws the setup error.
   * @returns {[toteA, toteB]} both rows with fresh updated_at
   */
  async swapTotes(aId, bId) {
    if (aId === null || aId === undefined || bId === null || bId === undefined || aId === bId) {
      throw new UserFacingError("Pick two different totes to swap.");
    }
    assertCapability("swap");

    // Hold both per-tote queues in a fixed order (no deadlock with a
    // concurrent swap of the same pair the other way round).
    const [first, second] = [aId, bId].sort((x, y) =>
      String(x).localeCompare(String(y))
    );
    return enqueueWrite(first, () =>
      enqueueWrite(second, async () => {
        // ---------- local mode ----------
        if (!supabase) {
          const totes = getLocalTotes();
          const ia = totes.findIndex((t) => t.id === aId);
          const ib = totes.findIndex((t) => t.id === bId);
          if (ia < 0 || ib < 0) {
            throw new UserFacingError("One of those totes no longer exists.");
          }
          if (
            isReservedPosition(totes[ia].position) ||
            isReservedPosition(totes[ib].position)
          ) {
            throw new UserFacingError("Those totes can't be swapped.");
          }
          const stamp = new Date().toISOString();
          const positionA = totes[ia].position;
          totes[ia] = { ...totes[ia], position: totes[ib].position, updated_at: stamp };
          totes[ib] = { ...totes[ib], position: positionA, updated_at: stamp };
          saveLocalTotes(totes);
          return [totes[ia], totes[ib]];
        }

        // ---------- cloud mode ----------
        try {
          const { data, error } = await supabase.rpc("swap_tote_positions", {
            a_id: aId,
            b_id: bId,
          });
          if (error) throw error;
          const rows = Array.isArray(data) ? data : data ? [data] : [];
          const a = rows.find((r) => r.id === aId);
          const b = rows.find((r) => r.id === bId);
          if (!a || !b) {
            throw new UserFacingError("One of those totes no longer exists.");
          }
          return [a, b];
        } catch (err) {
          if (err?.code === "P0002") {
            throw new UserFacingError("One of those totes no longer exists.");
          }
          if (err?.code === "22023") {
            throw new UserFacingError("Those totes can't be swapped.");
          }
          throw friendlyError(err, "swap the totes");
        }
      })
    );
  },

  // -------------------------------------------------------------------------
  // Removed-items bin — one reserved row ("__removed_items__") whose items
  // are entries { id, item, toteId, toteName, position, removedAt }.
  // No schema change; appends go through the same compare-and-swap path as
  // every other item write.
  // -------------------------------------------------------------------------

  /**
   * Remember items that were removed from `tote` so they can be put back
   * for 30 days. Creates the bin row on first use.
   * @param {object} tote   the tote they came from ({ id, name, position })
   * @param {object[]} items the removed items (full item objects)
   * @returns the saved bin row, or null when nothing was given
   */
  async recordRemovedItems(tote, items) {
    const list = normalizeItems(items);
    if (list.length === 0) return null;
    const entries = makeRemovedEntries(tote, list);

    for (let attempt = 0; attempt < 2; attempt++) {
      const bin = await ensureRemovedItemsRow(entries);
      if (bin.created) return bin.row;
      try {
        return await toteService.updateItems(bin.id, appendRemovedEntries(entries));
      } catch (err) {
        // The bin row vanished (purged by hand) — forget it and recreate once
        if (attempt === 0 && err?.message === NOT_FOUND_MESSAGE) {
          removedRowId = null;
          continue;
        }
        throw err;
      }
    }
    return null;
  },

  /** Entries in the removed-items bin, newest first (max 200, ≤ 30 days). */
  async listRemovedItems() {
    return removedEntriesFromRows(await readRemovedItemsRows());
  },

  /**
   * Put a removed item back: into the tote it came from when that still
   * exists, otherwise into `targetToteId`. Then drops the bin entry.
   * @throws {UserFacingError} TOTE_GONE when the original tote is gone and
   *   no target was given — the caller should offer a tote picker
   * @returns the saved target tote
   */
  async restoreRemovedItem(entryId, targetToteId) {
    const rows = await readRemovedItemsRows();
    let holder = null;
    let entry = null;
    rows.forEach((row) => {
      if (entry) return;
      const found = (Array.isArray(row.items) ? row.items : []).find(
        (e) => e?.id === entryId
      );
      if (found) {
        holder = row;
        entry = found;
      }
    });
    if (!entry || !entry.item) {
      throw new UserFacingError("That item is no longer in the bin.", {
        code: "NO_TOMBSTONE",
      });
    }

    let target = null;
    if (entry.toteId !== null && entry.toteId !== undefined) {
      if (await isLiveTote(entry.toteId)) target = entry.toteId;
    }
    if (target === null) {
      if (targetToteId === null || targetToteId === undefined) {
        throw new UserFacingError(
          `The tote "${entry.toteName || "it came from"}" is gone. Pick a tote to put it in.`,
          { code: "TOTE_GONE" }
        );
      }
      if (!(await isLiveTote(targetToteId))) {
        throw new UserFacingError(NOT_FOUND_MESSAGE);
      }
      target = targetToteId;
    }

    const saved = await toteService.updateItems(target, addItem(entry.item));
    await toteService.updateItems(holder.id, removeItem(entryId));
    return saved;
  },

  /**
   * Upload an image and return its public URL.
   * Local mode stores a data-URI instead. In cloud mode a failed upload
   * THROWS — base64 fallbacks used to bloat the database rows.
   */
  async uploadImage(file, fileName) {
    if (!supabase) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the photo."));
        reader.readAsDataURL(file);
      });
    }

    try {
      const { error } = await supabase.storage
        .from("tote-images")
        .upload(fileName, file);
      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from("tote-images")
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (err) {
      throw friendlyError(err, "upload the photo");
    }
  },

  /**
   * Delete older duplicate rows (same position, stale copies created by a
   * legacy bug). Only ever deletes the exact ids passed in — the caller
   * shows the user what will be removed and gets confirmation first.
   * @returns {number} rows removed
   */
  async cleanupDuplicates(duplicateGroups) {
    if (!supabase) return 0;
    const ids = duplicateGroups.flatMap((g) => g.older.map((t) => t.id));
    if (ids.length === 0) return 0;
    try {
      const { error } = await supabase.from("totes").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    } catch (err) {
      throw friendlyError(err, "remove the duplicates");
    }
  },

  /**
   * Move legacy base64-embedded photos into Supabase Storage and update the
   * owning rows to reference the URL instead. Uploads happen before the row
   * update, so a failure part-way never loses a photo.
   * @returns {number} photos migrated
   */
  async migrateEmbeddedPhotos(totes) {
    if (!supabase) return 0;
    const embedded = findEmbeddedPhotos(totes);
    let migrated = 0;

    // Group by tote so each row is updated once
    const byTote = new Map();
    embedded.forEach(({ tote, item }) => {
      const entry = byTote.get(tote.id) || { tote, itemIds: new Set() };
      entry.itemIds.add(item.id);
      byTote.set(tote.id, entry);
    });

    for (const { tote, itemIds } of byTote.values()) {
      const ops = [];
      for (const item of tote.items) {
        if (!itemIds.has(item.id)) continue;
        const blob = dataUriToBlob(item.image);
        const file = new File([blob], "photo.jpg", {
          type: blob.type || "image/jpeg",
        });
        const compressed = await compressImage(file);
        const url = await this.uploadImage(
          compressed,
          `migrated-${tote.id}-${item.id}-${Date.now()}.jpg`
        );
        ops.push(setItemImage(item.id, url));
        migrated += 1;
      }
      // Item-op path: only the photo of these specific items changes, so a
      // rename/move or item edit made meanwhile on the other phone survives.
      if (ops.length > 0) {
        await this.updateItems(tote.id, composeOps(...ops));
      }
    }
    return migrated;
  },

  /**
   * Subscribe to real-time changes on the totes table.
   *
   * `onChange(payload)` fires for every row change; `onStatus(status, err)`
   * mirrors the channel lifecycle ("SUBSCRIBED" | "CHANNEL_ERROR" |
   * "TIMED_OUT" | "CLOSED") so the caller can show "Reconnecting…" and
   * resubscribe after iOS suspends the websocket in the background.
   * Returns the channel (pass it to unsubscribeFromChanges) or null when
   * there is no cloud / the channel could not be created.
   */
  subscribeToChanges(onChange, onStatus) {
    if (!supabase) return null;
    try {
      return supabase
        .channel(nextChannelTopic())
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "totes" },
          onChange
        )
        .subscribe((status, err) => {
          if (typeof onStatus !== "function") return;
          try {
            onStatus(status, err);
          } catch {
            // a status listener must never break the realtime client
          }
        });
    } catch {
      return null;
    }
  },

  /** Leave a channel from subscribeToChanges and free its timers. */
  unsubscribeFromChanges(channel) {
    if (!channel) return;
    try {
      const result =
        supabase && typeof supabase.removeChannel === "function"
          ? supabase.removeChannel(channel)
          : channel.unsubscribe();
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      // already closed — nothing to release
    }
  },
};

// Each subscription gets its own topic: supabase.channel(topic) hands back
// an existing channel with the same name until its leave completes, so
// re-using "totes_changes" during a resubscribe could re-join a channel
// that is still shutting down.
let channelSeq = 0;
function nextChannelTopic() {
  channelSeq += 1;
  return `totes_changes_${channelSeq}`;
}
