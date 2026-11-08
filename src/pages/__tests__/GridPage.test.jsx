import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GridPage from "../GridPage";

const state = vi.hoisted(() => ({ totes: [] }));

vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({
    totes: state.totes,
    totesByPosition: Object.fromEntries(state.totes.map((t) => [t.position, t])),
    loading: true, // skip the wall carousel; only the header is under test
    refreshing: false,
    source: "supabase",
    walls: [],
    totalPositions: 35,
    loadData: vi.fn(),
    updateItems: vi.fn(),
  }),
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("../../components/TidyUpBanner", () => ({ default: () => null }));

const tote = (items) => ({
  id: 1,
  name: "Paint",
  position: "A1",
  updated_at: "2026-06-01T00:00:00.000Z",
  items,
});

// Search text and Garage / All totes mode live in App (so Back keeps your
// place); GridPage is controlled, so render it the way App does.
function renderGrid() {
  return render(
    <GridPage
      onSelectTote={vi.fn()}
      searchTerm=""
      onSearchChange={vi.fn()}
      mode="garage"
      onModeChange={vi.fn()}
      onAddTote={vi.fn()}
      activeWallId="front"
      onWallChange={vi.fn()}
      onClearHighlight={vi.fn()}
    />
  );
}

describe("GridPage restock button", () => {
  beforeEach(() => {
    state.totes = [];
  });

  it("is hidden when nothing is at quantity 0", () => {
    state.totes = [tote([{ id: 1, name: "Tape" }, { id: 2, name: "Glue", qty: 3 }])];
    renderGrid();
    expect(screen.queryByRole("button", { name: /^Restock/ })).not.toBeInTheDocument();
  });

  it("reads 'Restock' plus the count at every width, and opens the sheet", async () => {
    state.totes = [
      tote([
        { id: 1, name: "Blue paint", qty: 0 },
        { id: 2, name: "Tape", qty: 0 },
      ]),
    ];
    const user = userEvent.setup();
    renderGrid();

    const button = screen.getByRole("button", { name: "Restock, 2 items" });
    expect(button).toHaveTextContent("Restock");
    expect(button).toHaveTextContent("2");
    // The label is never hidden behind a breakpoint: on a phone the word
    // must be visible, not only in the aria-label
    const word = within(button).getByText("Restock");
    expect(word.className).not.toMatch(/\bhidden\b|sr-only/);
    expect(button).toHaveClass("min-h-[44px]");

    await user.click(button);
    expect(screen.getByRole("dialog", { name: "Restock" })).toBeInTheDocument();
  });

  it("sits on the status line below the search box (the title row has no room for a label on a phone)", () => {
    state.totes = [tote([{ id: 1, name: "Blue paint", qty: 0 }])];
    renderGrid();

    const button = screen.getByRole("button", { name: "Restock, 1 item" });
    const search = screen.getByLabelText("Search totes and items");
    // Rendered after the search box in document order, i.e. not on the title row
    expect(search.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // and shares a row with "Last updated"
    expect(button.parentElement).toHaveTextContent(/Last updated/);
    // The title still has its logo and never wraps
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("whitespace-nowrap", "min-w-0");
  });

  it("still shows the button when no tote has a timestamp", () => {
    state.totes = [{ ...tote([{ id: 1, name: "Blue paint", qty: 0 }]), updated_at: undefined }];
    renderGrid();
    expect(screen.getByRole("button", { name: "Restock, 1 item" })).toBeInTheDocument();
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });
});
