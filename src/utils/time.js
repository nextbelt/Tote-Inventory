// Timestamp helpers for "last updated / last modified" labels.

/** Best-known modification time of a tote, as epoch ms (0 if unknown). */
export function toteModifiedTime(tote) {
  const t = new Date(tote?.updated_at || tote?.created_at || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** The most recent modification time across all totes, or null. */
export function latestModified(totes = []) {
  const max = totes.reduce((m, t) => Math.max(m, toteModifiedTime(t)), 0);
  return max > 0 ? new Date(max) : null;
}

/** "Nov 8, 2026, 3:14 PM" */
export function formatDateTime(date) {
  return new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "just now", "5 min ago", "3 hr ago", "yesterday", "4 days ago", else a date. */
export function formatRelative(date, now = Date.now()) {
  const diff = Math.max(0, now - new Date(date).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
