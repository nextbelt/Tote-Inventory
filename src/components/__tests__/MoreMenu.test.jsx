import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWalls, wallPositions } from "../../utils/constants";
import MoreMenu from "../MoreMenu";

const state = vi.hoisted(() => ({ ctx: null }));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => state.ctx }));
vi.mock("../Toast", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

const walls = buildWalls();
const tote = (id, position, name = `Tote ${id}`) => ({
  id,
  name,
  position,
  items: [],
});

function setup(over = {}) {
  const totes = over.totes ?? [tote(1, "A1", "Paint"), tote(2, "B3", "Camping")];
  state.ctx = {
    totes,
    totesByPosition: Object.fromEntries(totes.map((t) => [t.position, t])),
    walls,
    deleted: [],
    source: "cloud",
    lastSyncedAt: Date.now(),
    connection: "live",
    listRemovedItems: vi.fn().mockResolvedValue([]),
    ...over,
  };
  const onClose = vi.fn();
  render(<MoreMenu onClose={onClose} />);
  return { onClose };
}

describe("MoreMenu", () => {
  beforeEach(() => {
    state.ctx = null;
  });

  it("lists the three entries and the sync status in words", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Backup & export/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print labels/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recently deleted/ })).toBeInTheDocument();
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Synced just now");
  });

  it("says so when data is kept on this device only", () => {
    setup({ source: "local", connection: "offline", lastSyncedAt: null });
    expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
    expect(screen.getByText(/Saved on this device only/)).toBeInTheDocument();
  });

  it("says when it is showing an offline copy", () => {
    setup({ source: "cache", connection: "offline" });
    expect(screen.getByTestId("sync-status")).toHaveTextContent(/Offline/);
  });

  it("counts deleted totes plus removed items, hiding ones already back", async () => {
    const totes = [
      { ...tote(1, "A1", "Paint"), items: [{ id: "back", name: "Brush" }] },
    ];
    const entry = (id, itemId, toteId) => ({
      id: `${toteId}:${itemId}:2026-11-01T00:00:00.000Z`,
      item: { id: itemId, name: String(itemId) },
      toteId,
      toteName: "Paint",
      position: "A1",
      removedAt: "2026-11-01T00:00:00.000Z",
    });
    setup({
      totes,
      deleted: [{ id: 9, name: "Old", originalPosition: "B1", deletedAt: "2026-11-01T00:00:00.000Z", items: [] }],
      listRemovedItems: vi
        .fn()
        .mockResolvedValue([entry(1, "back", 1), entry(1, "gone", 1), entry(77, "x", 77)]),
    });
    // 1 deleted tote + 2 removed items still missing (the third is back in Paint)
    const row = screen.getByRole("button", { name: /Recently deleted/ });
    await waitFor(() => expect(within(row).getByLabelText("3 waiting")).toBeInTheDocument());
  });

  it("opens Backup & export and comes back to the menu when it closes", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Backup & export/ }));
    expect(screen.getByRole("dialog", { name: "Backup & export" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Close" })[1]);
    expect(screen.getByRole("dialog", { name: "More" })).toBeInTheDocument();
  });

  it("prints labels for the visible totes, with every slot position for shelf labels", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Print labels/ }));
    expect(screen.getByRole("dialog", { name: "Print labels" })).toBeInTheDocument();
    // Tote labels: one per tote, linking to that tote on this origin
    const toteLabels = screen.getAllByTestId("label-print");
    expect(toteLabels).toHaveLength(2);
    expect(toteLabels[0]).toHaveTextContent(`${window.location.origin}/?tote=1`);
    // Shelf-edge labels: every slot on the walls, empty ones too
    await user.click(screen.getByRole("switch", { name: /shelf-edge labels/i }));
    const all = wallPositions(walls);
    const slotLabels = screen.getAllByTestId("label-print");
    expect(slotLabels).toHaveLength(all.length);
    expect(slotLabels.length).toBeGreaterThan(2);
    expect(slotLabels[0]).toHaveTextContent(`${window.location.origin}/?slot=${all[0]}`);
    // The "where" line uses the spoken-style spot text
    expect(screen.getAllByText(/Front wall · Left rack · top shelf/).length).toBeGreaterThan(0);
  });

  it("opens Recently deleted", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Recently deleted/ }));
    expect(screen.getByRole("dialog", { name: "Recently deleted" })).toBeInTheDocument();
  });
});
