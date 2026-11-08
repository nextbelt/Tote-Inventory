import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { searchTotes } from "../../utils/search";
import SearchResults from "../SearchResults";

const totes = [
  {
    id: 1,
    name: "Camping Gear",
    position: "A1",
    tags: ["summer", "outdoor"],
    notes: "Stove fuel is expired",
    items: [
      { id: 7, name: "Lantern", qty: 1, note: "needs new mantles" },
      { id: "u1", name: "Mantles box", qty: 2 },
    ],
  },
];

function renderResults(query) {
  const onOpenTote = vi.fn();
  render(
    <SearchResults
      results={searchTotes(totes, query)}
      query={query}
      onOpenTote={onOpenTote}
      onShowMe={vi.fn()}
    />
  );
  return { onOpenTote };
}

describe("SearchResults note and tag snippets", () => {
  it("shows the matching item note, highlighted, under a note-only match", () => {
    renderResults("mantles");
    const rows = screen.getAllByRole("listitem");
    // name match first, note match last
    expect(within(rows[0]).getByText("Mantles", { selector: "strong" })).toBeInTheDocument();
    expect(within(rows[0]).queryByTestId("match-snippet")).toBeNull();
    const snippet = within(rows[1]).getByTestId("match-snippet");
    expect(snippet).toHaveTextContent("Note: needs new mantles");
    expect(within(snippet).getByText("mantles", { selector: "strong" })).toBeInTheDocument();
  });

  it("shows tags and tote notes on tote rows", () => {
    renderResults("summer");
    expect(screen.getByTestId("match-snippet")).toHaveTextContent("Tag: summer");
  });

  it("labels tote notes", () => {
    renderResults("expired");
    expect(screen.getByTestId("match-snippet")).toHaveTextContent("Tote note: Stove fuel is expired");
  });

  it("a note-matched item row still opens with the item id", async () => {
    const user = userEvent.setup();
    const { onOpenTote } = renderResults("new mantles");
    await user.click(screen.getByRole("button", { name: /Lantern/ }));
    expect(onOpenTote).toHaveBeenCalledWith(totes[0], { itemId: 7 });
  });
});
