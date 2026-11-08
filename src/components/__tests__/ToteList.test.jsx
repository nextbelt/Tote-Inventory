import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ToteList from "../ToteList";

const state = vi.hoisted(() => ({ capabilities: { tags: true, notes: true, swap: true } }));

vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({ capabilities: state.capabilities }),
}));

const totes = [
  {
    id: 1,
    name: "Winter gear",
    position: "LW10",
    updated_at: "2026-03-01T00:00:00.000Z",
    tags: ["Seasonal", "Winter"],
    items: [{ id: 1, name: "Gloves", qty: 2 }],
  },
  {
    id: "uuid-2",
    name: "Tools",
    position: "A1",
    updated_at: "2026-05-01T00:00:00.000Z",
    tags: ["Workshop"],
    items: [{ id: "u-1", name: "Drill bits", qty: 0 }],
  },
  {
    id: 3,
    name: "Paint",
    position: "LW2",
    updated_at: "2026-04-01T00:00:00.000Z",
    items: [{ id: 3, name: "Brush" }],
  },
  // Reserved rows must never show, whatever the caller hands in
  { id: 90, name: "layout", position: "__config__", items: [] },
  { id: 91, name: "bin", position: "__removed_items__", items: [] },
  { id: 92, name: "Tombstone", position: "__deleted__:B2:92", items: [] },
];

const names = () =>
  within(screen.getByRole("list", { name: "All totes" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("button span.block.truncate").textContent);

const renderList = (onSelectTote = vi.fn()) =>
  render(<ToteList totes={totes} onSelectTote={onSelectTote} />);

describe("ToteList", () => {
  beforeEach(() => {
    state.capabilities = { tags: true, notes: true, swap: true };
    sessionStorage.clear();
  });
  afterEach(() => sessionStorage.clear());

  it("lists by spot (numeric aware) and never shows reserved rows", () => {
    renderList();
    expect(names()).toEqual(["Tools", "Paint", "Winter gear"]);
    expect(screen.queryByText("layout")).not.toBeInTheDocument();
    expect(screen.queryByText("bin")).not.toBeInTheDocument();
    expect(screen.queryByText("Tombstone")).not.toBeInTheDocument();
  });

  it("sorts by recently changed and by name", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: "Recently changed" }));
    expect(names()).toEqual(["Tools", "Paint", "Winter gear"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Paint", "Tools", "Winter gear"]);
    expect(screen.getByRole("button", { name: "Name" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the tapped tote", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderList(onSelect);
    await user.click(screen.getByText("Paint"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("filters to out of stock and can clear", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: /Out of stock/ }));
    expect(names()).toEqual(["Tools"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 totes");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toHaveLength(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("filters by tag chips when tags are available", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: /^Winter/ }));
    expect(names()).toEqual(["Winter gear"]);
    await user.click(screen.getByRole("button", { name: /^Workshop/ }));
    expect(names()).toEqual(["Tools", "Winter gear"]);
  });

  it("hides every tag control and indicator when the tags capability is off", () => {
    state.capabilities = { tags: false, notes: false, swap: false };
    renderList();
    expect(screen.queryByRole("button", { name: /^Winter/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-tags")).not.toBeInTheDocument();
    // out of stock still works
    expect(screen.getByRole("button", { name: /Out of stock/ })).toBeInTheDocument();
  });

  it("ignores a remembered tag filter when tags are off", () => {
    sessionStorage.setItem(
      "totes-list-prefs",
      JSON.stringify({ sort: "spot", tags: ["Workshop"], outOfStock: false })
    );
    state.capabilities = { tags: false, notes: false, swap: false };
    renderList();
    expect(names()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows an empty state with a way out when nothing matches", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: /^Winter/ }));
    await user.click(screen.getByRole("button", { name: /Out of stock/ }));
    expect(screen.getByText("No totes match these filters.")).toBeInTheDocument();
    const clears = screen.getAllByRole("button", { name: "Clear filters" });
    await user.click(clears[clears.length - 1]);
    expect(names()).toHaveLength(3);
  });

  it("remembers the choice for the session", async () => {
    const user = userEvent.setup();
    const first = renderList();
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.click(screen.getByRole("button", { name: /Out of stock/ }));
    first.unmount();

    renderList();
    expect(screen.getByRole("button", { name: "Name" })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Tools"]);
  });

  it("still works when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Paint", "Tools", "Winter gear"]);
  });

  it("drops a remembered tag nobody has any more instead of emptying the list", () => {
    sessionStorage.setItem(
      "totes-list-prefs",
      JSON.stringify({ sort: "spot", tags: ["Vanished"], outOfStock: false })
    );
    renderList();
    expect(names()).toHaveLength(3);
  });

  it("shows tag labels on rows, with a +N overflow", () => {
    const many = [
      { id: 1, name: "Many", position: "A1", items: [], tags: ["a", "b", "c", "d"] },
    ];
    render(<ToteList totes={many} onSelectTote={vi.fn()} />);
    const row = screen.getByTestId("row-tags");
    expect(row).toHaveTextContent("a");
    expect(row).toHaveTextContent("b");
    expect(row).toHaveTextContent("+2");
  });

  it("explains an empty garage", () => {
    render(<ToteList totes={[totes[3]]} onSelectTote={vi.fn()} />);
    expect(screen.getByText(/No totes yet/)).toBeInTheDocument();
  });
});
