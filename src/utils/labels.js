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
 * `describe(position)` may return a string or { path } (describePosition).
 */
export function buildLabels({ totes, origin, describe, slotMode }) {
  const list = (totes || []).filter(
    (t) => t && t.position && !isReservedPosition(t.position)
  );
  if (!slotMode) {
    return list.map((t) => ({
      key: `tote-${t.id}`,
      title: t.name || t.position,
      where: whereText(describe, t.position),
      url: buildToteUrl(origin, t.id),
    }));
  }
  const seen = new Set();
  const labels = [];
  for (const t of list) {
    if (seen.has(t.position)) continue;
    seen.add(t.position);
    labels.push({
      key: `slot-${t.position}`,
      title: t.position,
      where: whereText(describe, t.position),
      url: buildSlotUrl(origin, t.position),
    });
  }
  return labels;
}
