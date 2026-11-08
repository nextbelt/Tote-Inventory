import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ToteCard from "../ToteCard";

const tote = (extra = {}) => ({
  id: 1,
  name: "Paint",
  position: "A1",
  items: [{ id: 1, name: "Brush" }],
  ...extra,
});

describe("ToteCard tag indicator", () => {
  it("compact: shows a colored dot (not a label) for a tagged tote and names the tags", () => {
    render(
      <ToteCard position="A1" tote={tote({ tags: ["Workshop", "Winter"] })} onClick={vi.fn()} />
    );
    const dot = screen.getByTestId("tag-dot");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.className).toMatch(/\bbg-\w+-400\b/);
    expect(screen.queryByTestId("tag-label")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "A1: Paint, 1 item, tagged Workshop, Winter"
    );
  });

  it("wide: shows the first tag as a label with light and dark colors", () => {
    render(
      <ToteCard
        variant="wide"
        position="LW1"
        tote={tote({ position: "LW1", tags: ["Workshop", "Winter"] })}
        onClick={vi.fn()}
      />
    );
    const label = screen.getByTestId("tag-label");
    expect(label).toHaveTextContent("Workshop");
    expect(label.className).toMatch(/dark:text-/);
    expect(label.className).toMatch(/dark:bg-/);
  });

  it("uses the same color for the same tag in both variants", () => {
    const { unmount } = render(
      <ToteCard position="A1" tote={tote({ tags: ["tools"] })} onClick={vi.fn()} />
    );
    const dotColor = screen.getByTestId("tag-dot").className.match(/bg-(\w+)-400/)[1];
    unmount();
    render(
      <ToteCard variant="wide" position="A1" tote={tote({ tags: ["Tools"] })} onClick={vi.fn()} />
    );
    expect(screen.getByTestId("tag-label").className).toContain(`bg-${dotColor}-100`);
  });

  it("shows no indicator without tags, for empty slots, or for old rows with no tags field", () => {
    const { rerender } = render(<ToteCard position="A1" tote={tote()} onClick={vi.fn()} />);
    expect(screen.queryByTestId("tag-dot")).not.toBeInTheDocument();
    rerender(<ToteCard position="A1" tote={tote({ tags: [] })} onClick={vi.fn()} />);
    expect(screen.queryByTestId("tag-dot")).not.toBeInTheDocument();
    rerender(<ToteCard position="A1" onClick={vi.fn()} />);
    expect(screen.queryByTestId("tag-dot")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAccessibleName("A1: empty slot, add a tote");
  });

  it("keeps compact text at 11px or larger", () => {
    render(<ToteCard position="A1" tote={tote()} onClick={vi.fn()} />);
    const html = screen.getByRole("button").innerHTML;
    expect(html).not.toMatch(/text-\[(9|10)px\]/);
  });
});
