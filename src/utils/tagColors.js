// Stable colour for a tag label. The same tag always gets the same colour on
// every phone (a hash of the lower-cased text, no stored state).
//
// Class strings are written out in full so Tailwind can see them. Every chip
// pairs a 100-shade background with a 900-shade text (and the reverse in dark
// mode), which is well above 4.5:1 for all of these hues.

const PALETTE = [
  {
    chip: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
    dot: "bg-blue-400",
  },
  {
    chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
    dot: "bg-emerald-400",
  },
  {
    chip: "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
    dot: "bg-rose-400",
  },
  {
    chip: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
    dot: "bg-violet-400",
  },
  {
    chip: "bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100",
    dot: "bg-orange-400",
  },
  {
    chip: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
    dot: "bg-teal-400",
  },
  {
    chip: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900 dark:text-fuchsia-100",
    dot: "bg-fuchsia-400",
  },
  {
    chip: "bg-lime-100 text-lime-900 dark:bg-lime-900 dark:text-lime-100",
    dot: "bg-lime-400",
  },
];

/** FNV-1a, 32 bit. Plenty for picking one of eight colours. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** { chip, dot } Tailwind classes for a tag (case-insensitive). */
export function tagColor(tag) {
  const key = String(tag ?? "").trim().toLocaleLowerCase();
  return PALETTE[hash(key) % PALETTE.length];
}

export const TAG_PALETTE_SIZE = PALETTE.length;
