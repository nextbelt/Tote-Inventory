import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// localStorage fallback
// ---------------------------------------------------------------------------

function getLocalTotes() {
  try {
    const data = localStorage.getItem("totes-inventory");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLocalTotes(totes) {
  try {
    localStorage.setItem("totes-inventory", JSON.stringify(totes));
  } catch {
    // localStorage may be full or unavailable — silently degrade
  }
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

    // Filter to only totes not already in Supabase
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
    // eslint-disable-next-line no-console
    console.log(
      `Migration complete: ${toInsert.length} totes synced to Supabase ` +
        `(${localTotes.length - toInsert.length} already existed).`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("localStorage → Supabase migration failed, will retry next load:", err);
    // Don't mark as done — will retry on next page load
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const toteService = {
  /** Test whether the Supabase connection is healthy. */
  async testConnection() {
    if (!supabase) return false;
    try {
      const { error } = await supabase
        .from("totes")
        .select("count", { count: "exact", head: true });
      return !error;
    } catch {
      return false;
    }
  },

  /** Return all totes ordered by creation date. */
  async getTotes() {
    if (!supabase) return getLocalTotes();

    try {
      const { data, error } = await supabase
        .from("totes")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    } catch {
      return getLocalTotes();
    }
  },

  /**
   * Create or update a tote.
   * @param {object}  tote   – tote data (must include `id` for updates)
   * @param {boolean} isNew  – true  → INSERT, false → UPDATE
   */
  async saveTote(tote, isNew = false) {
    const toteData = {
      name: tote.name.trim(),
      position: tote.position,
      items: Array.isArray(tote.items) ? tote.items : [],
      updated_at: new Date().toISOString(),
    };

    // ---------- localStorage fallback ----------
    if (!supabase) {
      const totes = getLocalTotes();
      if (isNew) {
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
      if (idx >= 0) {
        totes[idx] = { ...totes[idx], ...toteData };
        saveLocalTotes(totes);
        return totes[idx];
      }
      return tote;
    }

    // ---------- Supabase ----------
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
    } catch {
      // Fall back to localStorage on network / Supabase errors
      const totes = getLocalTotes();
      if (isNew) {
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
      if (idx >= 0) {
        totes[idx] = { ...totes[idx], ...toteData };
        saveLocalTotes(totes);
        return totes[idx];
      }
      return tote;
    }
  },

  /** Delete a tote by ID. */
  async deleteTote(id) {
    if (!supabase) {
      saveLocalTotes(getLocalTotes().filter((t) => t.id !== id));
      return;
    }
    try {
      const { error } = await supabase.from("totes").delete().eq("id", id);
      if (error) throw error;
    } catch {
      saveLocalTotes(getLocalTotes().filter((t) => t.id !== id));
    }
  },

  /**
   * Upload an image and return its public URL.
   * Falls back to base64 data-URI when Supabase Storage is unavailable.
   */
  async uploadImage(file, fileName) {
    if (!supabase) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
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
    } catch {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
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
