import { ChevronRight, DatabaseBackup, HardDrive, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BackupSheet from "./BackupSheet";
import LabelSheet from "./LabelSheet";
import RecentlyDeletedSheet from "./RecentlyDeletedSheet";
import Sheet from "./Sheet";
import SyncStatus from "./SyncStatus";
import { useTotes } from "../hooks/useTotes";
import { describeSpot, wallPositions } from "../utils/constants";
import { visibleRemovedEntries } from "../utils/removedItems";

const rowClass =
  "apple-card flex min-h-[56px] w-full items-center gap-3 p-3 text-left";

function MenuRow({ icon: Icon, title, detail, count, onClick }) {
  return (
    <button type="button" onClick={onClick} className={rowClass}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </span>
        {detail && (
          <span className="block text-xs text-gray-600 dark:text-gray-400">
            {detail}
          </span>
        )}
      </span>
      {count !== undefined && count > 0 && (
        <span
          aria-label={`${count} waiting`}
          className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          {count}
        </span>
      )}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The "More" sheet on the Garage page: backup and export, label printing and
 * Recently deleted. It owns the sheets it opens, so closing one comes back
 * here.
 */
export default function MoreMenu({ onClose }) {
  const {
    totes,
    totesByPosition,
    walls,
    deleted,
    source,
    lastSyncedAt,
    connection,
    listRemovedItems,
  } = useTotes();
  const [view, setView] = useState("menu"); // "menu" | "backup" | "labels" | "deleted"
  const [removed, setRemoved] = useState([]);
  // Read through a ref: the bin is read when the menu shows, not on every
  // render that hands us a new function
  const listRef = useRef(listRemovedItems);
  listRef.current = listRemovedItems;

  // The count next to "Recently deleted" includes removed items, which live
  // in the bin (an async read); a failed read just leaves them out.
  useEffect(() => {
    if (view !== "menu") return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => listRef.current())
      .then((list) => {
        if (!cancelled) setRemoved(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view]);

  const deletedCount =
    (deleted?.length ?? 0) + visibleRemovedEntries(removed, totes).length;

  // Labels cover what the walls show (one tote per spot), in spot order
  const labelTotes = useMemo(
    () =>
      Object.values(totesByPosition).sort((a, b) =>
        a.position.localeCompare(b.position, undefined, { numeric: true })
      ),
    [totesByPosition]
  );
  const positions = useMemo(() => wallPositions(walls), [walls]);
  const describe = useCallback((position) => describeSpot(position, walls), [walls]);
  const backToMenu = useCallback(() => setView("menu"), []);

  if (view === "backup") return <BackupSheet onClose={backToMenu} />;
  if (view === "labels") {
    return (
      <LabelSheet
        totes={labelTotes}
        origin={window.location.origin}
        describe={describe}
        positions={positions}
        onClose={backToMenu}
      />
    );
  }
  if (view === "deleted") return <RecentlyDeletedSheet onClose={backToMenu} />;

  return (
    <Sheet title="More" onClose={onClose}>
      <div className="space-y-2">
        <MenuRow
          icon={DatabaseBackup}
          title="Backup & export"
          detail="Save a backup, export a list, restore"
          onClick={() => setView("backup")}
        />
        <MenuRow
          icon={Printer}
          title="Print labels"
          detail="QR codes for totes or shelf spots"
          onClick={() => setView("labels")}
        />
        <MenuRow
          icon={Trash2}
          title="Recently deleted"
          detail="Totes and items from the last 30 days"
          count={deletedCount}
          onClick={() => setView("deleted")}
        />

        <div className="pt-2">
          {source === "local" ? (
            <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Saved on this device only (cloud sync not set up)
            </p>
          ) : source ? (
            <SyncStatus
              source={source}
              lastSyncedAt={lastSyncedAt}
              connection={connection}
            />
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
