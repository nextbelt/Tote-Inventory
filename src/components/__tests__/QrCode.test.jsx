import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { encodeQr } from "../../vendor/qr";
import QrCode from "../QrCode";

describe("QrCode", () => {
  it("renders an svg whose module count matches the QR version (v1 = 21)", () => {
    const { container, getByRole } = render(
      <QrCode value="HELLO" size={100} label="Hello code" />
    );
    const svg = getByRole("img", { name: "Hello code" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("data-modules")).toBe("21");
    // 21 modules + 4-module quiet zone on each side
    expect(svg.getAttribute("viewBox")).toBe("0 0 29 29");
    expect(container.querySelector("path").getAttribute("d")).not.toBe("");
  });

  it("grows the version with the data at error correction M", () => {
    // Byte-mode M capacities: v1 14, v2 26, v3 42
    expect(encodeQr("a".repeat(14)).size).toBe(21);
    expect(encodeQr("a".repeat(15)).size).toBe(25);
    expect(encodeQr("a".repeat(26)).size).toBe(25);
    expect(encodeQr("a".repeat(27)).size).toBe(29);
    expect(encodeQr("https://x.app/?tote=12").version).toBe(2);
  });

  it("has the finder pattern in the top-left corner", () => {
    const qr = encodeQr("HELLO");
    for (let i = 0; i < 7; i += 1) {
      expect(qr.isDark(0, i)).toBe(true);
      expect(qr.isDark(i, 0)).toBe(true);
    }
    expect(qr.isDark(1, 1)).toBe(false);
    expect(qr.isDark(2, 2)).toBe(true);
  });

  it("encodes non-ASCII text without throwing and renders nothing for empty", () => {
    expect(() => encodeQr("Café ☃")).not.toThrow();
    const { container } = render(<QrCode value="" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
