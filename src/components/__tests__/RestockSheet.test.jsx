import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RestockSheet from "../RestockSheet";

const totes = vi.hoisted(() => ({
  hiddenDup: {
    id: 9,
    name: "Old Copy",
    position: "A1",
    updated_at: "2026-01-01",
    items: [{ id: 50, name: "Phantom", qty: 0 }],
  },
  a1: {
    id: 1,
    name: "Paint",
    position: "A1",
    updated_at: "2026-06-01",
    items: [
      { id: 7, name: "Blue paint", qty: 0, image: "https://x/blue.jpg" },
      { id: "u-2", name: "Brushes", qty: 4 },
      { id: "u-3", name: "Tape" },
    ],
  },
  lw10: {
    id: 2,
    name: "Tools",
    position: "LW10",
    updated_at: "2026-06-01",
    items: [{ id: "u-9", name: "Drill bits", qty: 0 }],
  },
  lw2: {
    id: 3,
    name: "Garden",
    position: "LW2",
    updated_at: "2026-06-01",
    items: [{ id: 4, name: "Twine", qty: 0 }],
  },
}));

// The visible totes the mocked store exposes (hiddenDup is deliberately absent).
const state = vi.hoisted(() => ({ visible: [] }));

const mockUpdateItems = vi.fn();
const mockShow = vi.fn();
const mockError = vi.fn();

vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({
    totesByPosition: Object.fromEntries(
      state.visible.map((t) => [t.position, t])
    ),
    updateItems: mockUpdateItems,
  }),
}));

vi.mock("../Toast", () => ({
  useToast: () => ({ show: mockShow, error: mockError, dismiss: vi.fn() }),
}));

describe("RestockSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.visible = [totes.a1, totes.lw10, totes.lw2];
    mockUpdateItems.mockResolvedValue({});
  });

  it("lists qty-0 items grouped by tote, in position order, with paths and photos", () => {
    render(<RestockSheet onClose={vi.fn()} onSelectTote={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Restock" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Paint", "Garden", "Tools"]);

    expect(screen.getByText("Blue paint")).toBeInTheDocument();
    expect(screen.getByText("Twine")).toBeInTheDocument();
    expect(screen.getByText("Drill bits")).toBeInTheDocument();
    expect(screen.getByText("Front wall · Left rack · Level 1")).toBeInTheDocument();
    expect(screen.getByText("Left wall · Shelf 10")).toBeInTheDocument();

    // not at zero, no qty, or a hidden duplicate: not listed
    expect(screen.queryByText("Brushes")).not.toBeInTheDocument();
    expect(screen.queryByText("Tape")).not.toBeInTheDocument();
    expect(screen.queryByText("Phantom")).not.toBeInTheDocument();

    const paint = screen.getByRole("region", { name: /Paint restock items/ });
    expect(paint.querySelector("img")).toHaveAttribute("src", "https://x/blue.jpg");
  });

  it("Got one adds exactly 1 to only that item and toasts", async () => {
    const user = userEvent.setup();
    render(<RestockSheet onClose={vi.fn()} onSelectTote={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Got one: Blue paint" }));

    expect(mockUpdateItems).toHaveBeenCalledTimes(1);
    const [toteId, op] = mockUpdateItems.mock.calls[0];
    expect(toteId).toBe(1);
    const before = totes.a1.items;
    const after = op(before);
    expect(after).toEqual([
      { id: 7, name: "Blue paint", qty: 1, image: "https://x/blue.jpg" },
      before[1],
      before[2],
    ]);
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining("Blue paint"),
      expect.objectContaining({ actionLabel: "Undo" })
    );
  });

  it("reports a failed save instead of a success toast", async () => {
    mockUpdateItems.mockRejectedValue(new Error("Offline"));
    const user = userEvent.setup();
    render(<RestockSheet onClose={vi.fn()} onSelectTote={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Got one: Twine" }));
    expect(mockError).toHaveBeenCalledWith("Offline");
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("tapping a row opens the tote with the original item id", async () => {
    const onSelectTote = vi.fn();
    const user = userEvent.setup();
    render(<RestockSheet onClose={vi.fn()} onSelectTote={onSelectTote} />);

    await user.click(screen.getByRole("button", { name: "Open Paint: Blue paint" }));
    expect(onSelectTote).toHaveBeenLastCalledWith(totes.a1, { itemId: 7 });

    await user.click(screen.getByRole("button", { name: "Open Tools: Drill bits" }));
    expect(onSelectTote).toHaveBeenLastCalledWith(totes.lw10, { itemId: "u-9" });
    expect(within(screen.getByRole("dialog")).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("RestockSheet empty state", () => {
  it("shows plain text when nothing is at zero", () => {
    state.visible = [{ ...totes.a1, items: [totes.a1.items[1]] }];
    render(<RestockSheet onClose={vi.fn()} onSelectTote={vi.fn()} />);
    expect(screen.getByText(/nothing to restock/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
