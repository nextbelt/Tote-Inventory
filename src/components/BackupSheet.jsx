import { FileSpreadsheet, FileUp, Save } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import { useTotes } from "../hooks/useTotes";
import {
  backupFilename,
  buildBackup,
  buildCsv,
  csvFilename,
  downloadFile,
  parseBackup,
  planRestore,
} from "../utils/backup";
import { describeSpot } from "../utils/constants";
import { addItem, composeOps } from "../utils/itemOps";
import { normalizeNotes, normalizeTags } from "../utils/validation";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rowButton =
  "apple-card flex min-h-[56px] w-full items-center gap-3 p-3 text-left disabled:opacity-50";

const countItems = (list) =>
  list.reduce((sum, it) => sum + (Array.isArray(it.items) ? it.items.length : 0), 0);

/** Totals of a restore plan, in the words shown to the user. */
function summarizePlan(plan) {
  const totes = plan.createTotes.length;
  const items =
    countItems(plan.createTotes) + countItems(plan.addItems);
  const lines = [];
  if (totes > 0 || items > 0) {
    lines.push(`Will add ${plural(totes, "tote")} and ${plural(items, "item")}`);
  }
  const skipped = plan.conflicts.length;
  const moved = plan.movedElsewhere.length;
  const notes = [];
  if (skipped > 0) {
    notes.push(
      skipped === 1
        ? "1 tote's spot is taken — skipped"
        : `${skipped} totes' spots are taken — skipped`
    );
  }
  if (moved > 0) {
    notes.push(
      `${plural(moved, "item")} already ${moved === 1 ? "lives" : "live"} in another tote — left alone`
    );
  }
  return { totes, items, text: [lines.join(""), ...notes].filter(Boolean).join("; ") };
}

function readText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Local mode ids a new tote by the clock; give each creation its own tick.
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

/**
 * Save a backup file, export the list as CSV, or restore from a backup.
 * Restoring only ever ADDS: totes that are gone are re-created in their free
 * spots and missing items are added to totes that still exist. Nothing is
 * deleted or overwritten, and spots that are taken are skipped and reported.
 */
export default function BackupSheet({ onClose }) {
  const { totes, layout, walls, capabilities, saveTote, updateItems } = useTotes();
  const fileRef = useRef(null);
  const totesRef = useRef(totes);
  totesRef.current = totes;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { tone: "ok" | "error", text }
  const [pending, setPending] = useState(null); // { backup, plan, fileName }
  const [result, setResult] = useState(null);

  const itemTotal = useMemo(() => countItems(totes), [totes]);

  const describe = (position) => describeSpot(position, walls);
  const sortedTotes = () =>
    [...totes].sort((a, b) =>
      String(a.position).localeCompare(String(b.position), undefined, {
        numeric: true,
      })
    );

  const report = (how, what) => {
    if (how === "cancelled") {
      setStatus({ tone: "ok", text: "Cancelled — nothing was saved." });
    } else if (how === "shared") {
      setStatus({
        tone: "ok",
        text: `${what} shared. Check that it arrived where you saved it.`,
      });
    } else {
      setStatus({
        tone: "ok",
        text: `${what} downloaded. Look in your Downloads or Files app.`,
      });
    }
  };

  // downloadFile must run straight from the tap (the share sheet needs it),
  // so the file text is built synchronously before it.
  const saveBackup = async () => {
    setResult(null);
    setStatus(null);
    try {
      const text = JSON.stringify(buildBackup({ totes, layout }), null, 2);
      const how = await downloadFile(backupFilename(), "application/json", text);
      report(how, "Backup");
    } catch {
      setStatus({ tone: "error", text: "Couldn't save the backup. Please try again." });
    }
  };

  const exportCsv = async () => {
    setResult(null);
    setStatus(null);
    try {
      const text = buildCsv(sortedTotes(), describe);
      const how = await downloadFile(csvFilename(), "text/csv", text);
      report(how, "List");
    } catch {
      setStatus({ tone: "error", text: "Couldn't export the list. Please try again." });
    }
  };

  const chooseFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so the same file can be picked again
    if (!file) return;
    setResult(null);
    setStatus(null);
    setPending(null);
    let text;
    try {
      text = await readText(file);
    } catch {
      setStatus({ tone: "error", text: "Couldn't read that file." });
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setStatus({ tone: "error", text: parsed.error });
      return;
    }
    setPending({
      backup: parsed.backup,
      plan: planRestore(parsed.backup, totesRef.current),
      fileName: file.name,
    });
  };

  const apply = async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // Plan again against the freshest data: the other phone may have changed
    // things since the file was chosen. Only ever adds.
    const plan = planRestore(pending.backup, totesRef.current);
    const out = {
      totes: 0,
      items: 0,
      skipped: plan.conflicts.map((c) => c.tote.name),
      failed: [],
    };
    let created = 0;
    for (const t of plan.createTotes) {
      if (created > 0) await tick();
      created += 1;
      const payload = {
        name: t.name,
        position: t.position,
        items: Array.isArray(t.items) ? t.items : [],
      };
      const tags = normalizeTags(t.tags);
      if (capabilities?.tags && tags.length > 0) payload.tags = tags;
      const notes = normalizeNotes(t.notes);
      if (capabilities?.notes && notes) payload.notes = notes;
      try {
        await saveTote(payload, true);
        out.totes += 1;
        out.items += payload.items.length;
      } catch (err) {
        out.failed.push(`“${t.name}”: ${err?.message || "could not be added"}`);
      }
    }
    for (const { toteId, items } of plan.addItems) {
      try {
        await updateItems(toteId, composeOps(...items.map((it) => addItem(it))));
        out.items += items.length;
      } catch (err) {
        const owner = totesRef.current.find((t) => t.id === toteId);
        out.failed.push(
          `Items for “${owner?.name ?? "a tote"}”: ${err?.message || "could not be added"}`
        );
      }
    }
    busyRef.current = false;
    setBusy(false);
    setPending(null);
    setResult(out);
  };

  const preview = pending ? summarizePlan(pending.plan) : null;
  const nothingToAdd = pending && preview.totes === 0 && preview.items === 0;

  return (
    <Sheet title="Backup & export" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {plural(totes.length, "tote")} and {plural(itemTotal, "item")}. Keep a
          backup file somewhere safe, like iCloud Drive.
        </p>

        <button type="button" onClick={saveBackup} className={rowButton}>
          <Save className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-gray-900 dark:text-gray-100">
              Save backup (JSON)
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              Everything, to restore from later
            </span>
          </span>
        </button>

        <button type="button" onClick={exportCsv} className={rowButton}>
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-gray-900 dark:text-gray-100">
              Export list (CSV)
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              For a spreadsheet or printing
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={rowButton}
        >
          <FileUp className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-gray-900 dark:text-gray-100">
              Restore from backup…
            </span>
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              Only adds what is missing. Never deletes or overwrites.
            </span>
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={chooseFile}
          aria-label="Backup file"
          className="hidden"
        />

        {status && (
          <p
            role={status.tone === "error" ? "alert" : "status"}
            className={`text-sm ${
              status.tone === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {status.text}
          </p>
        )}

        {pending && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/50" aria-label="Restore preview">
            <p className="text-xs text-gray-600 dark:text-gray-400">{pending.fileName}</p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              {nothingToAdd
                ? `Nothing to restore — everything in this backup is already here${
                    preview.text ? `; ${preview.text}` : ""
                  }.`
                : `${preview.text}.`}
            </p>
            {pending.plan.conflicts.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-gray-700 dark:text-gray-300">
                {pending.plan.conflicts.map((c) => (
                  <li key={String(c.tote.id)}>
                    “{c.tote.name}” ({c.tote.position}) — taken by “{c.occupiedBy.name}”
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy || nothingToAdd}
                className="apple-button flex min-h-[44px] flex-1 items-center justify-center disabled:opacity-50"
              >
                {busy ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div role="status" className="rounded-xl bg-gray-100 p-3 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            <p className="font-medium">
              Added {plural(result.totes, "tote")} and {plural(result.items, "item")}.
            </p>
            {result.skipped.length > 0 && (
              <p className="mt-1">
                Skipped because the spot is taken: {result.skipped.map((n) => `“${n}”`).join(", ")}.
              </p>
            )}
            {result.failed.length > 0 && (
              <div className="mt-1 text-red-600 dark:text-red-400">
                <p>Couldn&apos;t add:</p>
                <ul className="list-disc pl-5">
                  {result.failed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
