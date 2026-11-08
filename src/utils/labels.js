import { buildSlotUrl, buildToteUrl, isReservedPosition } from "./routes";

function whereText(describe, position) {
  if (!describe) return position;
  const d = describe(position);
  if (d && typeof d === "object") return d.path || position;
  return d || position;
}

/**
 * Build the label list. Tote labels: one per tote. Slot labels: one per
 * distinct shelf position (the tote in the slot may change; the slot does not).
 * When `positions` (the full list of grid slots) is given, slot labels cover
 * every one of them, including empty spots; otherwise they fall back to the
 * distinct positions that currently hold a tote.
 * `describe(position)` may return a string or { path } (describePosition).
 */
export function buildLabels({ totes, origin, describe, slotMode, positions }) {
  const list = (totes || []).filter(
    (t) => t && t.position && !isReservedPosition(t.position),
  );
  if (!slotMode) {
    return list.map((t) => ({
      key: `tote-${t.id}`,
      title: t.name || t.position,
      where: whereText(describe, t.position),
      url: buildToteUrl(origin, t.id),
    }));
  }
  const source = Array.isArray(positions)
    ? positions
    : list.map((t) => t.position);
  const seen = new Set();
  const labels = [];
  for (const position of source) {
    if (typeof position !== "string" || !position) continue;
    if (isReservedPosition(position) || seen.has(position)) continue;
    seen.add(position);
    labels.push({
      key: `slot-${position}`,
      title: position,
      where: whereText(describe, position),
      url: buildSlotUrl(origin, position),
    });
  }
  return labels;
}
