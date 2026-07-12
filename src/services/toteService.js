import { supabase } from "../lib/supabase";

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
      writeJSON(CACHE_KEY, totes);
      return { data: totes, source: "cloud" };
    } catch {
      return { data: readJSON(CACHE_KEY), source: "cache" };
    }
  },

  /**
   * Create or update a tote.
   * @param {object}  tote   – tote data (must include `id` for updates)
   * @param {boolean} isNew  – true → INSERT, false → UPDATE
   * @throws {Error} in cloud mode when the write fails (never shadow-saves)
   */
  async saveTote(tote, isNew = false) {
    const toteData = {
      name: tote.name.trim(),
      position: tote.position,
      items: Array.isArray(tote.items) ? tote.items : [],
      updated_at: new Date().toISOString(),
    };

    // ---------- local mode ----------
    if (!supabase) {
      const totes = getLocalTotes();
      if (isNew) {
        if (totes.some((t) => t.position === tote.position)) {
          throw new Error(
            "That spot already has a tote. Pick a different position."
          );
        }
        const localTote = {
          ...toteData,
          id: Date.now(),
          created_at: new Date().toISOString(),
        };
        totes.push(localTote);
        saveLocalTotes(totes);
        return localTote;
      }
      const idx = totes.findIndex((t) => t.id === tote.id);
      if (idx < 0) throw new Error("Couldn't find that tote to update.");
      totes[idx] = { ...totes[idx], ...toteData };
      saveLocalTotes(totes);
      return totes[idx];
    }

    // ---------- cloud mode ----------
    try {
      let data, error;
      if (isNew) {
        toteData.created_at = new Date().toISOString();
        ({ data, error } = await supabase
          .from("totes")
          .insert(toteData)
          .select()
          .single());
      } else {
        ({ data, error } = await supabase
          .from("totes")
          .update(toteData)
          .eq("id", tote.id)
          .select()
          .single());
      }
      if (error) throw error;
      return data;
    } catch (err) {
      throw friendlyError(err, isNew ? "save the tote" : "save your changes");
    }
  },

  /**
   * Delete a tote by ID.
   * @throws {Error} in cloud mode when the delete fails
   */
  async deleteTote(id) {
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
