import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buildLabels } from "../utils/labels";
import QrCode from "./QrCode";
import Sheet from "./Sheet";

// Print output is always black on white, independent of the app theme.
const PRINT_CSS = `
.label-print-root { display: none; }
@page { margin: 10mm; }
@media print {
  body > *:not(.label-print-root) { display: none !important; }
  html, body { background: #fff !important; }
  .label-print-root { display: block !important; color: #000; background: #fff; }
  .label-print-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .label-print-cell {
    box-sizing: border-box;
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px dashed #000;
    margin: -0.5px;
    padding: 6mm;
    min-height: 62mm;
    display: flex;
    align-items: center;
    gap: 5mm;
  }
  .label-print-cell svg { flex: none; }
  .label-print-text { min-width: 0; flex: 1; }
  .label-print-title {
    font: 700 22pt/1.1 system-ui, sans-serif;
    overflow-wrap: anywhere;
  }
  .label-print-where { font: 400 11pt/1.25 system-ui, sans-serif; margin-top: 2mm; }
  .label-print-url { font: 400 7pt/1.2 monospace; margin-top: 2mm; overflow-wrap: anywhere; }
}
`;

/**
 * Labels for printing: an on-screen preview in a bottom sheet and a
 * print-only copy portaled to <body>, so @media print can hide the whole app
 * (the sheet's scroll container would otherwise clip multi-page output).
 * Optional `positions`: the full list of grid slots, so shelf-edge labels also
 * cover empty spots (defaults to the positions that currently hold a tote).
 */
export default function LabelSheet({
  totes,
  origin,
  describe,
  positions,
  onClose,
}) {
  const [slotMode, setSlotMode] = useState(false);

  const labels = useMemo(
    () => buildLabels({ totes, origin, describe, slotMode, positions }),
    [totes, origin, describe, slotMode, positions],
  );

  return (
    <>
      <Sheet title="Print labels" onClose={onClose || (() => {})}>
        <div className="space-y-3">
          <button
            type="button"
            role="switch"
            aria-checked={slotMode}
            onClick={() => setSlotMode((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-gray-100 px-4 text-left text-sm font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          >
            <span>Shelf-edge labels</span>
            <span
              aria-hidden="true"
              className={`relative h-6 w-11 rounded-full transition-colors ${
                slotMode ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  slotMode ? "left-[22px]" : "left-0.5"
                }`}
              />
            </span>
          </button>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {slotMode
              ? "One label per shelf spot. Scanning opens whatever tote is there."
              : "One label per tote. Scanning opens that tote."}
          </p>

          <button
            type="button"
            onClick={() => window.print()}
            disabled={labels.length === 0}
            className="apple-button flex min-h-[44px] w-full items-center justify-center gap-2 disabled:opacity-50"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
            Print
          </button>

          {labels.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-600 dark:text-gray-400">
              No totes to label yet.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2" aria-label="Label preview">
              {labels.map((l) => (
                <li
                  key={l.key}
                  data-testid="label-preview"
                  className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-gray-300 p-2 text-center dark:border-gray-600"
                >
                  <QrCode
                    value={l.url}
                    size={96}
                    label={`QR code for ${l.title}`}
                  />
                  <span className="w-full break-words text-sm font-bold text-gray-900 dark:text-gray-100">
                    {l.title}
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {l.where}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      {createPortal(
        <div className="label-print-root" aria-hidden="true">
          <style>{PRINT_CSS}</style>
          <div className="label-print-grid">
            {labels.map((l) => (
              <div
                key={l.key}
                className="label-print-cell"
                data-testid="label-print"
              >
                <QrCode
                  value={l.url}
                  size={120}
                  label={`QR code for ${l.title}`}
                />
                <div className="label-print-text">
                  <div className="label-print-title">{l.title}</div>
                  <div className="label-print-where">{l.where}</div>
                  <div className="label-print-url">{l.url}</div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
