import { supabase } from "../lib/supabase";
import { compressImage } from "../utils/images";
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

/** Convert Supabase/network failures into messages a person can act on. */
function friendlyError(err, action) {
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
   * Return all totes plus where they came from:
   *   { data, source: "cloud" | "cache" | "local" }
   * "cache" means the cloud is unreachable and this is the last-known copy.
   */
  async getTotes() {
    if (!supabase) return { data: getLocalTotes(), source: "local" };

    try {
      const { data, error } = await supabase
        .from("totes")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const totes = data || [];
      // Strip embedded photos so a multi-MB legacy row can't overflow
      // the localStorage quota and silently kill offline browsing
      writeJSON(CACHE_KEY, stripForCache(totes));
      return { data: totes, source: "cloud" };
    } catch {
      return { data: readJSON(CACHE_KEY), source: "cache" };
    }
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
   * Create or update a tote.
   * @param {object}  tote   – tote data (must include `id` for updates)
   * @param {boolean} isNew  – true → INSERT, false → UPDATE
   * @throws {Error} in cloud mode when the write fails (never shadow-saves)
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
      const items = [];
      for (const item of tote.items) {
        if (!itemIds.has(item.id)) {
          items.push(item);
          continue;
        }
        const blob = dataUriToBlob(item.image);
        const file = new File([blob], "photo.jpg", {
          type: blob.type || "image/jpeg",
        });
        const compressed = await compressImage(file);
        const url = await this.uploadImage(
          compressed,
          `migrated-${tote.id}-${item.id}-${Date.now()}.jpg`
        );
        items.push({ ...item, image: url });
        migrated += 1;
      }
      await this.saveTote({ ...tote, items }, false);
    }
    return migrated;
  },

  /** Subscribe to real-time changes on the totes table. */
  subscribeToChanges(callback) {
    if (!supabase) return null;
    try {
      return supabase
        .channel("totes_changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "totes" },
          callback
        )
        .subscribe();
    } catch {
      return null;
    }
  },
};
