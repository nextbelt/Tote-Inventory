import { Check, CloudOff, RefreshCw } from "lucide-react";
import { formatTimeOfDay } from "../utils/time";
import RelativeTime from "./RelativeTime";

/**
 * Small gray "how fresh is this?" line for the household's two phones.
 *
 *   source "cloud" + connection "live"       → "Synced just now" / "Synced 5 min ago"
 *   connection "connecting"                  → "Reconnecting…" (or "Connecting…" before the first sync)
 *   source "cache" or connection "offline"   → "Offline — showing the copy from 2:10 PM"
 *   source "local"                           → nothing (no cloud to sync with)
 *
 * Props: { source: "cloud" | "cache" | "local" | null,
 *          lastSyncedAt: epoch ms | Date | ISO string | null,
 *          connection: "live" | "connecting" | "offline" }
 * Purely presentational — pass the values from useTotes().
 */
export default function SyncStatus({ source, lastSyncedAt, connection, className = "" }) {
  if (source === "local") return null;

  let icon = null;
  let text = null;
  let spin = false;

  if (source === "cache" || connection === "offline") {
    icon = CloudOff;
    const at = formatTimeOfDay(lastSyncedAt);
    text = at
      ? `Offline — showing the copy from ${at}`
      : "Offline — showing the last saved copy";
  } else if (connection === "connecting" || !lastSyncedAt) {
    icon = RefreshCw;
    spin = true;
    text = lastSyncedAt ? "Reconnecting…" : "Connecting…";
  } else {
    icon = Check;
    text = (
      <>
        Synced <RelativeTime date={lastSyncedAt} />
      </>
    );
  }

  const Icon = icon;
  return (
    <p
      className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${className}`.trim()}
      aria-live="polite"
      data-testid="sync-status"
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${spin ? "animate-spin motion-reduce:animate-none" : ""}`.trim()}
        aria-hidden="true"
      />
      <span>{text}</span>
    </p>
  );
}
