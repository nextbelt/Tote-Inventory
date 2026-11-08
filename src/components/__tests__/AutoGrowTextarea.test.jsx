import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import AutoGrowTextarea from "../AutoGrowTextarea";

// jsdom does no layout (scrollHeight is always 0): stand in for it
const fakeScrollHeight = (fn) =>
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return fn(this);
    },
  });
const restoreScrollHeight = () => {
  delete HTMLTextAreaElement.prototype.scrollHeight;
};

function Box() {
  const [v, setV] = useState("");
  return (
    <AutoGrowTextarea aria-label="box" value={v} onChange={(e) => setV(e.target.value)} />
  );
}

describe("AutoGrowTextarea", () => {
  afterEach(restoreScrollHeight);

  it("sizes itself to its wrapped content and caps at about four lines", () => {
    fakeScrollHeight((el) => 20 * (1 + el.value.split("\n").length));
    render(<Box />);
    const el = screen.getByLabelText("box");
    expect(el.style.height).toBe("40px");
    fireEvent.change(el, { target: { value: "a\nb\nc" } });
    expect(el.style.height).toBe("80px");
    expect(el.className).toContain("max-h-[7.5rem]");
  });

  it("leaves the height alone when nothing can be measured", () => {
    render(<Box />);
    expect(screen.getByLabelText("box").style.height).toBe("auto");
  });
});
