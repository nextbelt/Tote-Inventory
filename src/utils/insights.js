import { itemQty } from "./itemOps";

const byPosition = (a, b) =>
  String(a.position).localeCompare(String(b.position), undefined, {
    numeric: true,
  });

/**
 * Every item at quantity 0, as [{ tote, item }] sorted by tote position
 * (numeric-aware, so LW2 comes before LW10); items keep their order inside
 * a tote. Pass the VISIBLE totes (Object.values(totesByPosition)) so hidden
 * duplicate rows never add phantom entries. Items with no qty count as 1.
 */
export function restockItems(totes) {
  const out = [];
  [...(Array.isArray(totes) ? totes : [])]
    .filter((tote) => tote && tote.position !== "__config__")
    .sort(byPosition)
    .forEach((tote) => {
      (Array.isArray(tote.items) ? tote.items : []).forEach((item) => {
        if (item && itemQty(item) === 0) out.push({ tote, item });
      });
    });
  return out;
}
