import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GridPage from "../GridPage";

const state = vi.hoisted(() => ({ totes: [] }));

vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({
    totes: state.totes,
    totesByPosition: Object.fromEntries(state.totes.map((t) => [t.position, t])),
    loading: false,
    refreshing: false,
    source: "supabase",
    walls: [],
    totalPositions: 35,
    capabilities: { tags: true, notes: true, swap: true },
    loadData: vi.fn(),
    updateItems: vi.fn(),
  }),
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("../../components/TidyUpBanner", () => ({ default: () => null }));

describe("GridPage All totes list", () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.totes = [
      { id: 1, name: "Paint", position: "A1", items: [], tags: ["Garage"] },
      { id: 2, name: "hidden layout", position: "__config__", items: [] },
    ];
  });

  it("renders the sortable list and never a reserved row", () => {
    render(
      <GridPage
        onSelectTote={vi.fn()}
        searchTerm=""
        onSearchChange={vi.fn()}
        mode="list"
        onModeChange={vi.fn()}
        onAddTote={vi.fn()}
        activeWallId="front"
        onWallChange={vi.fn()}
        onClearHighlight={vi.fn()}
      />
    );
    const list = screen.getByRole("list", { name: "All totes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("hidden layout")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sort totes by" })).toBeInTheDocument();
  });
});
