// Backup & export logic (pure, no UI). A later batch adds the sheet that
// calls these. Nothing here talks to the database: restoring is planned as
// "what is missing" so it can only ever ADD data, never delete or overwrite.

import { itemQty } from "./itemOps";

export const BACKUP_APP = "garage-totes";
export const BACKUP_VERSION = 1;

const isReserved = (tote) =>
  typeof tote?.position === "string" && tote.position.startsWith("__");

const isId = (v) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && v !== "");

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// ── Building ─────────────────────────────────────────────────────────────

/** Snapshot of everything worth keeping, excluding hidden "__" rows. */
export function buildBackup({ totes, layout, exportedAt } = {}) {
  const rows = (Array.isArray(totes) ? totes : [])
    .filter((t) => t && !isReserved(t))
    .map((t) => {
      const out = {
        id: t.id,
        name: t.name,
        position: t.position,
        items: Array.isArray(t.items) ? t.items.map((it) => ({ ...it })) : [],
      };
      if (t.tags !== undefined && t.tags !== null) out.tags = t.tags;
      if (t.notes !== undefined && t.notes !== null) out.notes = t.notes;
      out.created_at = t.created_at ?? null;
      out.updated_at = t.updated_at ?? null;
      return out;
    });
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: exportedAt ?? new Date().toISOString(),
    layout: layout ?? null,
    totes: rows,
  };
}

function datePart(date) {
  const d =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "garage-totes-backup-2026-11-08.json" (local date). */
export const backupFilename = (date = new Date()) =>
  `${BACKUP_APP}-backup-${datePart(date)}.json`;

/** "garage-totes-2026-11-08.csv" (local date). */
export const csvFilename = (date = new Date()) =>
  `${BACKUP_APP}-${datePart(date)}.csv`;

// ── CSV ──────────────────────────────────────────────────────────────────

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180: quote fields containing comma, quote, CR or LF. */
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Photo column: only real web links are useful in a spreadsheet. Old
 * un-migrated photos are base64 data: URIs (can be megabytes, and Excel/
 * Numbers cap a cell at 32,767 characters), so they get a short marker; the
 * full value stays in the JSON backup, which is the real restore source.
 */
export const EMBEDDED_PHOTO_MARKER = "(embedded photo)";

function photoCell(image) {
  if (typeof image !== "string") return "";
  const v = image.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^data:/i.test(v)) return EMBEDDED_PHOTO_MARKER;
  return "";
}

function locationText(describe, position) {
  if (typeof describe !== "function") return position ?? "";
  const d = describe(position);
  if (d && typeof d === "object") return d.path ?? d.label ?? position ?? "";
  return d ?? position ?? "";
}

/**
 * CSV with header Tote,Location,Item,Quantity,Photo. One row per item, or a
 * single row (blank item) for an empty tote. UTF-8 BOM first so Excel and
 * Numbers read accents correctly; CRLF line endings.
 */
export function buildCsv(totes, describe) {
  const lines = [["Tote", "Location", "Item", "Quantity", "Photo"]];
  (Array.isArray(totes) ? totes : [])
    .filter((t) => t && !isReserved(t))
    .forEach((t) => {
      const location = locationText(describe, t.position);
      const items = Array.isArray(t.items) ? t.items : [];
      if (items.length === 0) {
        lines.push([t.name, location, "", "", ""]);
        return;
      }
      items.forEach((it) => {
        lines.push([
          t.name,
          location,
          it?.name,
          itemQty(it),
          photoCell(it?.image),
        ]);
      });
    });
  return (
    BOM + lines.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n"
  );
}

// ── Parsing ──────────────────────────────────────────────────────────────

const fail = (error) => ({ ok: false, error });

/**
 * Validate backup text. Returns { ok: true, backup } or { ok: false, error }
 * where error is a message safe to show the user. Hidden "__" rows in the
 * file are ignored.
 */
export function parseBackup(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return fail("That file is empty.");
  }
  let data;
  try {
    data = JSON.parse((text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return fail("That file is not a backup (it is not valid JSON).");
  }
  if (!isPlainObject(data) || data.app !== BACKUP_APP) {
    return fail("That file is not a Garage Totes backup.");
  }
  if (
    typeof data.version !== "number" ||
    !Number.isFinite(data.version) ||
    data.version < 1
  ) {
    return fail("That backup has no valid version number.");
  }
  if (data.version > BACKUP_VERSION) {
    return fail(
      "That backup was made by a newer version of the app. Update the app and try again."
    );
  }
  if (!Array.isArray(data.totes)) {
    return fail("That backup is damaged: the list of totes is missing.");
  }

  const totes = [];
  for (let i = 0; i < data.totes.length; i++) {
    const t = data.totes[i];
    const where = `tote ${i + 1}`;
    if (!isPlainObject(t)) {
      return fail(`That backup is damaged: ${where} is not valid.`);
    }
    if (typeof t.position === "string" && t.position.startsWith("__")) continue;
    if (!isId(t.id)) return fail(`That backup is damaged: ${where} has no id.`);
    if (typeof t.name !== "string") {
      return fail(`That backup is damaged: ${where} has no name.`);
    }
    if (typeof t.position !== "string" || t.position === "") {
      return fail(`That backup is damaged: ${where} has no location.`);
    }
    if (!Array.isArray(t.items)) {
      return fail(
        `That backup is damaged: the items of "${t.name}" are not a list.`
      );
    }
    for (const it of t.items) {
      if (!isPlainObject(it) || !isId(it.id) || typeof it.name !== "string") {
        return fail(
          `That backup is damaged: an item in "${t.name}" is not valid.`
        );
      }
      if (
        it.qty !== undefined &&
        it.qty !== null &&
        !Number.isFinite(Number(it.qty))
      ) {
        return fail(
          `That backup is damaged: an item in "${t.name}" has a bad quantity.`
        );
      }
    }
    totes.push(t);
  }

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: data.version,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null,
      layout: isPlainObject(data.layout) ? data.layout : null,
      totes,
    },
  };
}

// ── Restore planning ─────────────────────────────────────────────────────

/**
 * Compare a backup to what exists now. Only ever ADDS:
 *  - createTotes: backup totes whose id is gone and whose slot is free
 *  - conflicts:   backup totes whose id is gone but whose slot is taken now
 *                 ({ tote, occupiedBy }) - the user must choose what to do
 *  - addItems:    items missing (by id) from totes that still exist
 *  - movedElsewhere: backup items that are NOT missing, because the same id
 *                 now lives in a different current tote (the app lets you
 *                 move items, which keeps the id). They are left out of
 *                 createTotes/conflicts/addItems so restoring never
 *                 duplicates them: { item, fromToteId, nowInToteId }
 * Ids are compared with their original types (1 is not "1").
 */
export function planRestore(backup, currentTotes) {
  const current = (Array.isArray(currentTotes) ? currentTotes : []).filter(
    (t) => t && !isReserved(t)
  );
  const byId = new Map(current.map((t) => [t.id, t]));
  const slotOwner = new Map(current.map((t) => [t.position, t]));

  // Where every item id lives right now, across ALL current totes.
  const itemHome = new Map();
  for (const t of current) {
    for (const it of Array.isArray(t.items) ? t.items : []) {
      if (it && !itemHome.has(it.id)) itemHome.set(it.id, t.id);
    }
  }

  const createTotes = [];
  const conflicts = [];
  const addItems = [];
  const movedElsewhere = [];

  // Items of backup tote `b` that should actually be restored. Skips ids that
  // already exist anywhere (same tote: simply present; other tote: moved) and
  // duplicate ids inside the backup itself.
  const itemsToRestore = (b) => {
    const seen = new Set();
    const keep = [];
    for (const it of Array.isArray(b.items) ? b.items : []) {
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      if (itemHome.has(it.id)) {
        const home = itemHome.get(it.id);
        if (home !== b.id) {
          movedElsewhere.push({ item: it, fromToteId: b.id, nowInToteId: home });
        }
        continue;
      }
      keep.push(it);
    }
    return keep;
  };

  // Keep the original object when nothing was filtered out.
  const withItems = (b, items) =>
    Array.isArray(b.items) && items.length === b.items.length
      ? b
      : { ...b, items };

  for (const b of Array.isArray(backup?.totes) ? backup.totes : []) {
    if (!b || isReserved(b)) continue;
    const existing = byId.get(b.id);
    const missing = itemsToRestore(b);
    if (existing) {
      if (missing.length) addItems.push({ toteId: existing.id, items: missing });
      continue;
    }
    const owner = slotOwner.get(b.position);
    if (owner) {
      conflicts.push({ tote: withItems(b, missing), occupiedBy: owner });
    } else {
      const planned = withItems(b, missing);
      createTotes.push(planned);
      slotOwner.set(b.position, planned); // two backup totes can't claim one slot
    }
  }

  return { createTotes, conflicts, addItems, movedElsewhere };
}

// ── Download ─────────────────────────────────────────────────────────────

// Long enough for a slow phone to finish reading a large blob.
const REVOKE_DELAY_MS = 60_000;

/**
 * Save text as a file. Returns a promise of how it went:
 *  - "shared":     the system share sheet took the file (Save to Files, etc.)
 *  - "cancelled":  the user dismissed the share sheet (nothing was saved)
 *  - "downloaded": fell back to a Blob + object URL + a[download] click
 *
 * In an installed iOS Home Screen app, a bare a[download] click can replace
 * the app view with the file (no back button) or do nothing, so the share
 * sheet is preferred when the browser can share files. Must be called
 * straight from a tap handler (share needs a user gesture). The caller should
 * confirm with the user that the file really arrived, and this needs a check
 * on a real iPhone.
 */
export async function downloadFile(filename, mime, text) {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    typeof File === "function"
  ) {
    try {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      }
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      // Any other share failure: fall through to the plain download.
    }
  }

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Revoke only after the browser has had plenty of time to read the blob.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, REVOKE_DELAY_MS);
  return "downloaded";
}
