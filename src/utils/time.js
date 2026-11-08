// Timestamp helpers for "last updated / last modified" labels.

// Each phone stamps updated_at with its own clock, so a fast clock can save
// a time slightly "in the future". Within this window we say "just now";
// beyond it we show the real date instead of pinning every device on
// "just now" until the clocks catch up.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Coerce a Date / ISO string / epoch ms into a valid Date, or null. */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** A tote's last-modified time (updated_at, else created_at), or null. */
export function toteModifiedDate(tote) {
  return toDate(tote?.updated_at) || toDate(tote?.created_at);
}

/** Epoch ms of a tote's last modification (0 if unknown). */
export function toteModifiedTime(tote) {
  return toteModifiedDate(tote)?.getTime() ?? 0;
}

/** The most recent modification time across all totes, or null. */
export function latestModified(totes = []) {
  const max = totes.reduce((m, t) => Math.max(m, toteModifiedTime(t)), 0);
  return max > 0 ? new Date(max) : null;
}

const formatDate = (d) =>
  d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** "Nov 8, 2026, 3:14 PM" — or "" for a missing/invalid date. */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "just now", "5 min ago", "3 hr ago", "1 day ago", "4 days ago", else a
 * date like "Nov 1, 2026". Returns "" for a missing/invalid date.
 */
export function formatRelative(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return "";
  const diff = now - d.getTime();
  if (diff < -FUTURE_TOLERANCE_MS) return formatDate(d);
  const min = Math.floor(Math.max(0, diff) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  return formatDate(d);
}
