import { supabase } from "../lib/supabase";
import { compressImage } from "../utils/images";
import { composeOps, normalizeItems, setItemImage } from "../utils/itemOps";
import { dataUriToBlob, findEmbeddedPhotos, stripForCache } from "../utils/maintenance";

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
export const CONFIG_POSITION = "__config__";

/** Split raw rows into real totes + the newest layout-settings row. */
function splitConfig(rows) {
  const totes = [];
  let config = null;
  (rows || []).forEach((row) => {
    if (row.position === CONFIG_POSITION) {
      if (
        !config ||
        new Date(row.updated_at || 0) > new Date(config.updated_at || 0)
      ) {
        config = row;
      }
    } else {
      totes.push(row);
    }
  });
  const layout =
    config && config.items && !Array.isArray(config.items)
      ? config.items
      : null;
  return { totes, layout, configRow: config };
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

/** An error whose message is already written for the user — never rewrapped. */
class UserFacingError extends Error {}

const NOT_FOUND_MESSAGE = "Couldn't find that tote to update.";

/** Convert Supabase/network failures into messages a person can act on. */
function friendlyError(err, action) {
  if (err instanceof UserFacingError) return err;
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
// Service
// ---------------------------------------------------------------------------

export const toteService = {
  /**
   * Return all totes, where they came from, and the saved layout settings:
   *   { data, source: "cloud" | "cache" | "local", layout | null }
   * "cache" means the cloud is unreachable and this is the last-known copy.
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
      return { data: getLocalTotes(), source: "local", layout };
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
      const { totes, layout } = splitConfig(data);
      return { data: totes, source: "cloud", layout };
    } catch {
      const { totes, layout } = splitConfig(readJSON(CACHE_KEY));
      return { data: totes, source: "cache", layout };
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
   * Patch specific fields of a tote (subset of name/position/items).
   * Field-level patches mean an item edit can never clobber a concurrent
   * move (and vice versa); per-tote queueing keeps writes ordered.
   * @throws {Error} in cloud mode when the write fails (never shadow-saves)
   */
  async updateTote(id, fields) {
    const patch = { ...fields, updated_at: new Date().toISOString() };
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.items !== undefined && !Array.isArray(patch.items)) {
      patch.items = [];
    }

    return enqueueWrite(id, async () => {
      // ---------- local mode ----------
      if (!supabase) {
        const totes = getLocalTotes();
        const idx = totes.findIndex((t) => t.id === id);
        if (idx < 0) throw new Error("Couldn't find that tote to update.");
        totes[idx] = { ...totes[idx], ...patch };
        saveLocalTotes(totes);
        return totes[idx];
      }

      // ---------- cloud mode ----------
      try {
        const { data, error } = await supabase
          .from("totes")
          .update(patch)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data;
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

    const toteData = {
      name: tote.name.trim(),
      position: tote.position,
      items: Array.isArray(tote.items) ? tote.items : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // ---------- local mode ----------
    if (!supabase) {
      const totes = getLocalTotes();
      if (totes.some((t) => t.position === tote.position)) {
        throw new Error(
          "That spot already has a tote. Pick a different position."
        );
      }
      const localTote = { ...toteData, id: Date.now() };
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
   * Delete a tote by ID.
   * @throws {Error} in cloud mode when the delete fails
   */
  async deleteTote(id) {
    return enqueueWrite(id, async () => {
      if (!supabase) {
        saveLocalTotes(getLocalTotes().filter((t) => t.id !== id));
        return;
      }
      try {
        const { error } = await supabase.from("totes").delete().eq("id", id);
        if (error) throw error;
      } catch (err) {
        throw friendlyError(err, "delete the tote");
      }
    });
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
