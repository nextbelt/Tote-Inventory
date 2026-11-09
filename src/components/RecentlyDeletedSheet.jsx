import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import TotePicker from "./TotePicker";
import { useToast } from "./Toast";
import { useTotes } from "../hooks/useTotes";
import { describeSpot } from "../utils/constants";
import { freePositionsByWall, visibleRemovedEntries } from "../utils/removedItems";
import { RETENTION_DAYS } from "../utils/reservedRows";
import { formatRelative } from "../utils/time";

const secondaryButton =
  "flex min-h-[44px] items-center justify-center rounded-xl bg-gray-100 px-4 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-100";
const primaryButton =
  "flex min-h-[44px] items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-blue-500";
const dangerButton =
  "flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold text-red-600 disabled:opacity-50 dark:text-red-400";

/** Pick one of the free spots on the walls (for a tote whose spot is taken). */
function FreeSpotPicker({ groups, walls, title, onPick, onClose }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-gray-500 dark:text-gray-400">
          Every spot is taken. Free one up first.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ wall, positions }) => (
            <section key={wall.id} aria-label={wall.label}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {wall.label}
              </h3>
              <ul className="space-y-2">
                {positions.map((position) => (
                  <li key={position}>
                    <button
                      type="button"
                      onClick={() => onPick(position)}
                      className="apple-card flex min-h-[44px] w-full items-center gap-3 p-3 text-left"
                    >
                      <span className="w-12 shrink-0 rounded-lg bg-gray-900 px-2 py-1 text-center text-xs font-bold text-yellow-300">
                        {position}
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-gray-900 dark:text-gray-100">
                        {describeSpot(position, walls)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Deleted totes and removed items, kept for 30 days.
 *  - Restore a tote to its original spot, or to a free spot when that one is
 *    taken now; "Delete forever" asks first.
 *  - Put a removed item back into the tote it came from; when that tote is
 *    gone, choose another tote. Items already back in their tote are hidden.
 */
export default function RecentlyDeletedSheet({ onClose }) {
  const {
    totes,
    totesByPosition,
    walls,
    deleted,
    restoreDeletedTote,
    purgeDeletedTote,
    listRemovedItems,
    restoreRemovedItem,
  } = useTotes();
  const toast = useToast();

  // Removed-items bin: undefined = loading, null = could not be read
  const [removed, setRemoved] = useState(undefined);
  const [confirmPurge, setConfirmPurge] = useState(null); // tote id
  const [pickSpotFor, setPickSpotFor] = useState(null); // deleted entry
  const [pickToteFor, setPickToteFor] = useState(null); // removed entry
  // One tap = one action: a second tap while a write is in flight is ignored
  const busyRef = useRef(new Set());
  const [busy, setBusy] = useState(() => new Set());

  // Read once when the sheet opens (through a ref, so a new function identity
  // on a later render does not trigger another read)
  const listRef = useRef(listRemovedItems);
  listRef.current = listRemovedItems;
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => listRef.current())
      .then((list) => {
        if (!cancelled) setRemoved(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setRemoved(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (key, fn) => {
    if (busyRef.current.has(key)) return undefined;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    try {
      return await fn();
    } finally {
      busyRef.current.delete(key);
      setBusy(new Set(busyRef.current));
    }
  }, []);

  const occupied = useMemo(
    () => new Set(totes.map((t) => t.position)),
    [totes]
  );
  const freeGroups = useMemo(
    () => freePositionsByWall(walls, totes),
    [walls, totes]
  );
  const items = useMemo(
    () => visibleRemovedEntries(removed, totes),
    [removed, totes]
  );

  // ---- deleted totes ----
  const restoreTote = (entry, position) =>
    run(`tote:${entry.id}`, async () => {
      try {
        const row = await restoreDeletedTote(entry.id, position);
        setPickSpotFor(null);
        toast.show(
          `Put “${entry.name}” back at ${describeSpot(row?.position ?? position ?? entry.originalPosition, walls)}`
        );
      } catch (err) {
        if (err?.code === "SLOT_TAKEN") {
          setPickSpotFor(entry);
          toast.error(`${describeSpot(position ?? entry.originalPosition, walls)} is taken. Pick a free spot.`);
        } else {
          toast.error(err?.message || "Couldn't put the tote back.");
        }
      }
    });

  const handleRestoreTote = (entry) => {
    if (occupied.has(entry.originalPosition)) setPickSpotFor(entry);
    else restoreTote(entry);
  };

  const purge = (entry) =>
    run(`tote:${entry.id}`, async () => {
      try {
        await purgeDeletedTote(entry.id);
        setConfirmPurge(null);
        toast.show(`Deleted “${entry.name}” for good`);
      } catch (err) {
        toast.error(err?.message || "Couldn't delete the tote.");
      }
    });

  // ---- removed items ----
  const putBack = (entry, targetToteId) =>
    run(`item:${entry.id}`, async () => {
      try {
        const saved = await restoreRemovedItem(entry.id, targetToteId);
        setRemoved((prev) => (prev || []).filter((e) => e.id !== entry.id));
        setPickToteFor(null);
        toast.show(`Put “${entry.item.name}” back in “${saved?.name ?? entry.toteName}”`);
      } catch (err) {
        if (err?.code === "TOTE_GONE") {
          setPickToteFor(entry);
        } else if (err?.code === "NO_TOMBSTONE") {
          // The other phone already put it back
          setRemoved((prev) => (prev || []).filter((e) => e.id !== entry.id));
          setPickToteFor(null);
          toast.error(err.message);
        } else if (err?.code === "ALREADY_THERE") {
          // It already lives in a tote (put back or moved on the other
          // phone before this phone caught up) — the service dropped the
          // stale entry rather than give the item a second home
          setRemoved((prev) => (prev || []).filter((e) => e.id !== entry.id));
          setPickToteFor(null);
          toast.show(err.message);
        } else {
          toast.error(err?.message || "Couldn't put the item back.");
        }
      }
    });

  if (pickSpotFor) {
    return (
      <FreeSpotPicker
        title={`Where should “${pickSpotFor.name}” go?`}
        groups={freeGroups}
        walls={walls}
        onPick={(position) => restoreTote(pickSpotFor, position)}
        onClose={() => setPickSpotFor(null)}
      />
    );
  }

  if (pickToteFor) {
    return (
      <TotePicker
        totes={Object.values(totesByPosition)}
        title={`Put “${pickToteFor.item.name}” in which tote?`}
        onPick={(tote) => putBack(pickToteFor, tote.id)}
        onClose={() => setPickToteFor(null)}
      />
    );
  }

  const nothing = deleted.length === 0 && items.length === 0;

  return (
    <Sheet title="Recently deleted" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Kept for {RETENTION_DAYS} days, then removed for good.
        </p>

        {removed === undefined && deleted.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading…
          </p>
        )}

        {removed !== undefined && nothing && (
          <p className="py-4 text-center text-gray-500 dark:text-gray-400">
            Nothing here. Deleted totes and removed items show up here.
          </p>
        )}

        {deleted.length > 0 && (
          <section aria-label="Deleted totes">
            <h3 className="apple-subtitle mb-2 text-base">Deleted totes</h3>
            <ul className="space-y-2">
              {deleted.map((entry) => {
                const count = Array.isArray(entry.items) ? entry.items.length : 0;
                const working = busy.has(`tote:${entry.id}`);
                return (
                  <li key={entry.id} className="apple-card p-3">
                    <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
                      {entry.name}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {describeSpot(entry.originalPosition, walls)} · {count} item
                      {count === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Deleted {formatRelative(entry.deletedAt) || "recently"}
                    </p>
                    {confirmPurge === entry.id ? (
                      <div className="mt-2" role="alert">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Delete “{entry.name}” forever? This can&apos;t be undone.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmPurge(null)}
                            className={`${secondaryButton} flex-1`}
                          >
                            Keep it
                          </button>
                          <button
                            type="button"
                            onClick={() => purge(entry)}
                            disabled={working}
                            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-red-500"
                          >
                            Delete forever
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreTote(entry)}
                          disabled={working}
                          aria-label={`Restore ${entry.name}`}
                          className={`${primaryButton} flex-1`}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPurge(entry.id)}
                          disabled={working}
                          aria-label={`Delete ${entry.name} forever`}
                          className={dangerButton}
                        >
                          Delete forever
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {removed === null && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Couldn&apos;t load removed items right now.
          </p>
        )}

        {items.length > 0 && (
          <section aria-label="Removed items">
            <h3 className="apple-subtitle mb-2 text-base">Removed items</h3>
            <ul className="space-y-2">
              {items.map((entry) => (
                <li
                  key={entry.id}
                  className="apple-card flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
                      {entry.item.name}
                    </p>
                    <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                      From “{entry.toteName || "a tote"}”
                      {entry.position ? ` (${entry.position})` : ""}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Removed {formatRelative(entry.removedAt) || "recently"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => putBack(entry)}
                    disabled={busy.has(`item:${entry.id}`)}
                    aria-label={`Put back ${entry.item.name}`}
                    className={`${secondaryButton} shrink-0`}
                  >
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
