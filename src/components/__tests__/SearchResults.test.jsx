import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildWalls } from "../../utils/constants";
import { searchTotes } from "../../utils/search";
import SearchResults from "../SearchResults";

const walls = buildWalls({ leftShelves: 3, leftColumns: 1 });

const totes = [
  {
    id: 1,
    name: "Camping Gear",
    position: "A1",
    items: [
      { id: 7, name: "Gas Lantern", qty: 0 }, // legacy numeric id
      { id: "uuid-1", name: "Lantern Mantles", qty: 4 },
    ],
  },
  { id: 2, name: "Garage Odds", position: "LW2", items: [] },
];

function renderResults(query, props = {}) {
  const onOpenTote = vi.fn();
  const onShowMe = vi.fn();
  render(
    <SearchResults
      results={searchTotes(totes, query)}
      query={query}
      walls={walls}
      onOpenTote={onOpenTote}
      onShowMe={onShowMe}
      {...props}
    />
  );
  return { onOpenTote, onShowMe };
}

describe("SearchResults", () => {
  it("bolds the matched words in result names", () => {
    renderResults("lantern");
    const bold = screen.getAllByText(/lantern/i, { selector: "strong" });
    expect(bold.map((el) => el.textContent).sort()).toEqual(["Lantern", "Lantern"]);
    expect(screen.queryByText("Gas", { selector: "strong" })).toBeNull();
  });

  it("says out of stock for a quantity of zero, and shows other quantities", () => {
    renderResults("lantern");
    expect(screen.getAllByText("out of stock")).toHaveLength(1);
    expect(screen.getByText("× 4")).toBeInTheDocument();
  });

  it("uses the exact spot wording", () => {
    renderResults("lantern");
    expect(
      screen.getAllByText(/Camping Gear · Front wall · Left rack · top shelf · left bin/)
    ).toHaveLength(2);
  });

  it("describes side-wall spots with the live shelf count", () => {
    renderResults("garage odds");
    expect(screen.getByText("Left wall · shelf 2 of 3")).toBeInTheDocument();
  });

  it("opens an item row with the item's original id (number or string)", async () => {
    const user = userEvent.setup();
    const { onOpenTote } = renderResults("lantern");

    await user.click(screen.getByRole("button", { name: /Gas Lantern/ }));
    expect(onOpenTote).toHaveBeenLastCalledWith(totes[0], { itemId: 7 });

    await user.click(screen.getByRole("button", { name: /Lantern Mantles/ }));
    expect(onOpenTote).toHaveBeenLastCalledWith(totes[0], { itemId: "uuid-1" });
  });

  it("opens a tote row without an item id", async () => {
    const user = userEvent.setup();
    const { onOpenTote } = renderResults("garage odds");
    await user.click(screen.getByRole("button", { name: /Garage Odds/ }));
    expect(onOpenTote).toHaveBeenCalledWith(totes[1]);
  });

  it("shows the empty state for no results", () => {
    renderResults("!!!");
    expect(screen.getByText(/Nothing matching/)).toBeInTheDocument();
  });
});
