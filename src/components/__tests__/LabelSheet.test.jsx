import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { describePosition } from "../../utils/constants";
import LabelSheet from "../LabelSheet";

const totes = [
  { id: 1, name: "Camping", position: "A3", items: [] },
  { id: 22, name: "Tools", position: "B3", items: [] },
  { id: 3, name: "Xmas", position: "LW7", items: [] },
  { id: 4, name: "Dup", position: "A3", items: [] },
  { id: 5, name: "Hidden", position: "__config__", items: [] },
];
const origin = "https://totes.example";

function setup() {
  return render(
    <LabelSheet
      totes={totes}
      origin={origin}
      describe={describePosition}
      onClose={() => {}}
    />
  );
}

describe("LabelSheet", () => {
  it("renders one label per tote with name, location and link text", () => {
    setup();
    const labels = screen.getAllByTestId("label-print");
    expect(labels).toHaveLength(4); // reserved position skipped
    const first = within(labels[0]);
    expect(first.getByText("Camping")).toBeInTheDocument();
    expect(first.getByText(describePosition("A3").path)).toBeInTheDocument();
    expect(first.getByText("https://totes.example/?tote=1")).toBeInTheDocument();
    expect(
      within(labels[1]).getByText("https://totes.example/?tote=22")
    ).toBeInTheDocument();
    expect(labels[0].querySelector("svg")).not.toBeNull();
    expect(screen.getAllByTestId("label-preview")).toHaveLength(4);
  });

  it("toggles to one deduplicated slot label per position", () => {
    setup();
    fireEvent.click(screen.getByRole("switch", { name: /shelf-edge labels/i }));
    const labels = screen.getAllByTestId("label-print");
    expect(labels).toHaveLength(3);
    expect(
      within(labels[0]).getByText("https://totes.example/?slot=A3")
    ).toBeInTheDocument();
    expect(within(labels[1]).getByText("B3")).toBeInTheDocument();
    expect(screen.queryByText("Camping")).toBeNull();
  });

  it("prints via window.print", () => {
    const print = vi.fn();
    window.print = print;
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^print$/i }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("includes print CSS that hides the rest of the app", () => {
    setup();
    const css = document.body.querySelector(".label-print-root style")
      .textContent;
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/grid-template-columns: 1fr 1fr/);
  });
});
