import qrcode from "./qrcode-generator.js";

// The library's default string-to-bytes truncates every character to 8 bits.
// Encode as UTF-8 instead, which is what phone camera apps decode.
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(String(s)));

/**
 * Encode `value` as a QR code (byte mode, error correction M, smallest
 * version that fits). Returns { size, version, isDark(row, col) }.
 */
export function encodeQr(value) {
  const qr = qrcode(0, "M");
  qr.addData(String(value), "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return {
    size,
    version: (size - 17) / 4,
    isDark: (row, col) => qr.isDark(row, col),
  };
}
