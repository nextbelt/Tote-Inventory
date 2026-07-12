import { Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "./Toast";
import Sheet from "./Sheet";
import { useTotes } from "../hooks/useTotes";
import { toteService } from "../services/toteService";
import {
  embeddedPhotoBytes,
  findDuplicates,
  findEmbeddedPhotos,
} from "../utils/maintenance";

/**
 * Legacy-data repair, offered (never forced) when problems are detected:
 *  - hidden duplicate rows per spot (an old bug inserted stale copies; the
 *    app shows only the newest, but deleting it would resurrect an old one)
 *  - photos embedded in the database as base64 (multi-MB downloads on
 *    every open). Both fixes run only after the user reviews the details.
 */
export default function TidyUpBanner() {
  const { totes, totesByPosition, source, loadData } = useTotes();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(null); // "dupes" | "photos" | null

  const isCloud = source === "cloud";
  const dupGroups = useMemo(
    () => (isCloud ? findDuplicates(totes) : []),
    [isCloud, totes]
  );
  // Only migrate photos on the rows the app actually shows — hidden
  // duplicates go away in the other action.
  const visibleTotes = useMemo(
    () => Object.values(totesByPosition),
    [totesByPosition]
  );
  const embedded = useMemo(
    () => (isCloud ? findEmbeddedPhotos(visibleTotes) : []),
    [isCloud, visibleTotes]
  );

  const dupCount = dupGroups.reduce((n, g) => n + g.older.length, 0);
  const photoMB = (embeddedPhotoBytes(visibleTotes) / (1024 * 1024)).toFixed(1);

  if (!isCloud || dismissed || (dupCount === 0 && embedded.length === 0)) {
    return null;
  }

  const removeDuplicates = async () => {
    setBusy("dupes");
    try {
      const removed = await toteService.cleanupDuplicates(dupGroups);
      toast.show(`Removed ${removed} hidden duplicate${removed === 1 ? "" : "s"}`);
      await loadData({ background: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const movePhotos = async () => {
    setBusy("photos");
    try {
      const moved = await toteService.migrateEmbeddedPhotos(visibleTotes);
      toast.show(
        `Moved ${moved} photo${moved === 1 ? "" : "s"} to photo storage`
      );
      await loadData({ background: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">
          Tidy-up available:{" "}
          {dupCount > 0 && `${dupCount} hidden duplicate record${dupCount === 1 ? "" : "s"}`}
          {dupCount > 0 && embedded.length > 0 && " and "}
          {embedded.length > 0 && `${embedded.length} slow photo${embedded.length === 1 ? "" : "s"} (${photoMB} MB every load)`}
          .
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[44px] shrink-0 rounded-lg px-2 font-bold text-amber-900 underline"
        >
          Review
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss tidy-up suggestion"
          className="flex h-11 w-8 shrink-0 items-center justify-center text-amber-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <Sheet title="Tidy up the database" onClose={() => busy || setOpen(false)}>
          {dupCount > 0 && (
            <section className="mb-6">
              <h3 className="mb-1 font-bold text-gray-900">
                Hidden duplicates ({dupCount})
              </h3>
              <p className="mb-2 text-sm text-gray-600">
                An old bug saved extra copies of some spots. The app shows
                only the newest copy — the one you see today. Removing the
                older hidden copies changes nothing on screen, but stops a
                deleted tote from being replaced by a stale copy.
              </p>
              <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-gray-50 p-2 text-sm">
                {dupGroups.map((g) => (
                  <li key={g.position} className="flex justify-between gap-2">
                    <span className="font-semibold text-gray-800">
                      {g.position} · keeps “{g.keep.name}”
                    </span>
                    <span className="shrink-0 text-gray-500">
                      removes {g.older.length} old cop{g.older.length === 1 ? "y" : "ies"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={removeDuplicates}
                disabled={busy !== null}
                className="min-h-[48px] w-full rounded-xl bg-amber-600 font-semibold text-white disabled:opacity-50"
              >
                {busy === "dupes"
                  ? "Removing…"
                  : `Remove ${dupCount} hidden duplicate${dupCount === 1 ? "" : "s"}`}
              </button>
            </section>
          )}

          {embedded.length > 0 && (
            <section>
              <h3 className="mb-1 font-bold text-gray-900">
                Slow photos ({embedded.length})
              </h3>
              <p className="mb-2 text-sm text-gray-600">
                {embedded.length === 1 ? "One photo is" : "Some photos are"}{" "}
                stored inside the database itself ({photoMB} MB downloaded on
                every open). Moving {embedded.length === 1 ? "it" : "them"} to
                photo storage keeps the same picture and makes the app load
                much faster. Nothing is removed until the copy succeeds.
              </p>
              <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-gray-50 p-2 text-sm">
                {embedded.map(({ tote, item }) => (
                  <li key={`${tote.id}-${item.id}`} className="text-gray-700">
                    “{item.name}” in {tote.position} · {tote.name}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={movePhotos}
                disabled={busy !== null}
                className="min-h-[48px] w-full rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50"
              >
                {busy === "photos"
                  ? "Moving photos…"
                  : `Move ${embedded.length} photo${embedded.length === 1 ? "" : "s"} to storage`}
              </button>
            </section>
          )}
        </Sheet>
      )}
    </>
  );
}
