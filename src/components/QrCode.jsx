import { useMemo } from "react";
import { encodeQr } from "../vendor/qr";

const QUIET_ZONE = 4; // modules, per the QR spec

/**
 * Crisp SVG QR code for a string. Error correction M, smallest fitting
 * version, 4-module quiet zone. Always dark-on-white (even in dark mode) so
 * phone cameras can read it.
 */
export default function QrCode({ value, size = 160, label, className }) {
  const qr = useMemo(() => (value ? encodeQr(value) : null), [value]);

  const path = useMemo(() => {
    if (!qr) return "";
    // One horizontal run per stretch of dark modules keeps the path small.
    let d = "";
    for (let row = 0; row < qr.size; row += 1) {
      let col = 0;
      while (col < qr.size) {
        if (!qr.isDark(row, col)) {
          col += 1;
          continue;
        }
        const start = col;
        while (col < qr.size && qr.isDark(row, col)) col += 1;
        const run = col - start;
        d += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
      }
    }
    return d;
  }, [qr]);

  if (!qr) return null;
  const total = qr.size + QUIET_ZONE * 2;

  return (
    <svg
      role="img"
      aria-label={label || `QR code for ${value}`}
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      data-modules={qr.size}
      data-version={qr.version}
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
