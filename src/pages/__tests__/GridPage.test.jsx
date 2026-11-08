import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GridPage from "../GridPage";

const state = vi.hoisted(() => ({ totes: [], header: {} }));

vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({
    totes: state.totes,
    totesByPosition: Object.fromEntries(state.totes.map((t) => [t.position, t])),
    loading: true, // skip the wall carousel; only the header is under test
    refreshing: false,
    source: "supabase",
    walls: [],
    deleted: [],
    listRemovedItems: async () => [],
    lastSyncedAt: null,
    connection: "live",
    ...state.header,
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

describe("GridPage header: More button and sync status", () => {
  beforeEach(() => {
    state.totes = [];
    state.header = {};
  });

  it("has a 44 px More button that opens the menu", async () => {
    const user = userEvent.setup();
    renderGrid();
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveClass("h-11", "w-11");
    // Next to the refresh button on the title row, i.e. before the search box
    const search = screen.getByLabelText("Search totes and items");
    expect(more.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(more.parentElement).toContainElement(screen.getByRole("button", { name: "Refresh" }));

    await user.click(more);
    const menu = screen.getByRole("dialog", { name: "More" });
    expect(within(menu).getByRole("button", { name: /Backup & export/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /Print labels/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /Recently deleted/ })).toBeInTheDocument();
  });

  it("shows the sync status on the status line with Last updated", () => {
    state.totes = [tote([{ id: 1, name: "Tape" }])];
    state.header = { source: "cloud", lastSyncedAt: Date.now(), connection: "live" };
    renderGrid();
    const sync = screen.getByTestId("sync-status");
    expect(sync).toHaveTextContent("Synced just now");
    expect(sync.parentElement.parentElement).toHaveTextContent(/Last updated/);
  });

  it("shows no sync line in local mode", () => {
    state.totes = [tote([{ id: 1, name: "Tape" }])];
    state.header = { source: "local", connection: "offline" };
    renderGrid();
    expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
  });

  it("says when it is showing an offline copy", () => {
    state.header = { source: "cache", lastSyncedAt: null, connection: "offline" };
    renderGrid();
    expect(screen.getByTestId("sync-status")).toHaveTextContent(/Offline/);
  });
});

describe("GridPage search", () => {
  const searchFor = (term) =>
    render(
      <GridPage
        onSelectTote={vi.fn()}
        searchTerm={term}
        onSearchChange={vi.fn()}
        mode="garage"
        onModeChange={vi.fn()}
        onAddTote={vi.fn()}
        activeWallId="front"
        onWallChange={vi.fn()}
        onClearHighlight={vi.fn()}
      />
    );

  beforeEach(() => {
    // Two rows claim A1; the walls show only one of them (the mock keeps the
    // last, like useTotes keeps the newest). The hidden one must not be found.
    state.totes = [
      { id: 1, name: "Old copy", position: "A1", updated_at: "2026-01-01T00:00:00.000Z", items: [{ id: 11, name: "Hammer" }] },
      { id: 2, name: "Paint", position: "A1", updated_at: "2026-06-01T00:00:00.000Z", items: [{ id: 12, name: "Brush" }] },
    ];
  });

  it("finds items in the tote the walls show", () => {
    searchFor("brush");
    expect(screen.getAllByText(/Paint/).length).toBeGreaterThan(0);
  });

  it("never surfaces a hidden duplicate row", () => {
    searchFor("hammer");
    expect(screen.queryByText(/Old copy/)).not.toBeInTheDocument();
  });
});
