import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const STORE_KEY = "totes-inventory";

const baseTotes = [
  {
    id: 1,
    name: "Camping Gear",
    position: "B3",
    items: [{ id: "i1", name: "Lantern", qty: 2 }],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Holiday Lights",
    position: "RW1",
    items: [{ id: "i2", name: "String Lights", qty: 1 }],
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
];

function seedTotes(totes = baseTotes) {
  localStorage.setItem(STORE_KEY, JSON.stringify(totes));
}

function readStore() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("renders the garage with wall tabs and seeded totes", async () => {
    seedTotes();
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Garage Totes" })
    ).toBeInTheDocument();

    expect(
      await screen.findByLabelText(/^B3: Camping Gear/)
    ).toBeInTheDocument();

    const wallGroup = screen.getByRole("group", { name: "Choose a wall" });
    expect(within(wallGroup).getByRole("button", { name: "Left" })).toBeInTheDocument();
    expect(within(wallGroup).getByRole("button", { name: "Front" })).toBeInTheDocument();
    expect(within(wallGroup).getByRole("button", { name: "Right" })).toBeInTheDocument();
  });

  it("finds an item via search and shows its location", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText(/^B3: Camping Gear/);

    const search = screen.getByLabelText("Search totes and items");
    await user.type(search, "lantern");

    expect(await screen.findByText("Lantern")).toBeInTheDocument();
    expect(screen.getByText(/Front wall/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show me/i })).toBeInTheDocument();
  });

  it("shows 'Nothing matching' for a query with no results", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText(/^B3: Camping Gear/);

    const search = screen.getByLabelText("Search totes and items");
    await user.type(search, "zzzzqqq");

    expect(await screen.findByText(/Nothing matching/i)).toBeInTheDocument();
  });

  it("keeps the search text after opening a result and coming back", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText(/^B3: Camping Gear/);
    const search = screen.getByLabelText("Search totes and items");
    await user.type(search, "lantern");

    await user.click(await screen.findByRole("button", { name: /Lantern/ }));
    expect(
      await screen.findByRole("heading", { name: "Camping Gear" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Garage" }));

    expect(await screen.findByLabelText("Search totes and items")).toHaveValue(
      "lantern"
    );
    expect(screen.getByRole("list", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByText("Lantern")).toBeInTheDocument();
  });

  it("keeps the All totes mode after opening a tote and coming back", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText(/^B3: Camping Gear/);
    await user.click(screen.getByRole("button", { name: "All totes" }));

    const list = await screen.findByRole("list", { name: "All totes" });
    await user.click(within(list).getByRole("button", { name: /Holiday Lights/ }));
    await screen.findByRole("heading", { name: "Holiday Lights" });

    await user.click(screen.getByRole("button", { name: "Garage" }));

    expect(await screen.findByRole("list", { name: "All totes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All totes" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("restores the scroll position when coming back to the results", async () => {
    seedTotes();
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.type(screen.getByLabelText("Search totes and items"), "lantern");

      window.scrollY = 420;
      await user.click(await screen.findByRole("button", { name: /Lantern/ }));
      await screen.findByRole("heading", { name: "Camping Gear" });
      window.scrollY = 0;

      await user.click(screen.getByRole("button", { name: "Garage" }));
      await screen.findByRole("list", { name: "Search results" });
      expect(scrollTo).toHaveBeenCalledWith(0, 420);
    } finally {
      window.scrollTo = originalScrollTo;
      window.scrollY = 0;
    }
  });

  it("restores the scroll where the user was after adding a tote, not an older tote's", async () => {
    seedTotes();
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.type(screen.getByLabelText("Search totes and items"), "lantern");

      // Open a tote at 600 and come back (restored to 600)
      window.scrollY = 600;
      await user.click(await screen.findByRole("button", { name: /Lantern/ }));
      await screen.findByRole("heading", { name: "Camping Gear" });
      window.scrollY = 0;
      await user.click(screen.getByRole("button", { name: "Garage" }));
      await screen.findByRole("list", { name: "Search results" });
      expect(scrollTo).toHaveBeenLastCalledWith(0, 600);

      // Clear the search, scroll to the top, start adding a tote, then Back:
      // lands at the top again, not at the 600 remembered from the tote
      await user.clear(screen.getByLabelText("Search totes and items"));
      scrollTo.mockClear();
      window.scrollY = 0;
      await user.click(
        await screen.findByRole("button", { name: "A1: empty slot, add a tote" })
      );
      await screen.findByRole("heading", { name: "New Tote" });
      await user.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
      expect(scrollTo).not.toHaveBeenCalledWith(0, 600);

      // Same again from a non-zero position: lands where the user left
      window.scrollY = 250;
      await user.click(
        await screen.findByRole("button", { name: "A1: empty slot, add a tote" })
      );
      await screen.findByRole("heading", { name: "New Tote" });
      window.scrollY = 0;
      await user.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(scrollTo).toHaveBeenLastCalledWith(0, 250);
    } finally {
      window.scrollTo = originalScrollTo;
      window.scrollY = 0;
    }
  });

  it("comes back to the top of a grid that was at the top, even after the tote page was scrolled", async () => {
    seedTotes();
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.type(screen.getByLabelText("Search totes and items"), "lantern");

      // Grid at the very top; open a result (a highlighted item scrolls the
      // tote page down), then Back
      window.scrollY = 0;
      await user.click(await screen.findByRole("button", { name: /Lantern/ }));
      await screen.findByRole("heading", { name: "Camping Gear" });
      scrollTo.mockClear();
      window.scrollY = 400;

      await user.click(screen.getByRole("button", { name: "Garage" }));
      await screen.findByRole("list", { name: "Search results" });
      // Restored to 0 explicitly — the browser would otherwise keep ~400
      expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    } finally {
      window.scrollTo = originalScrollTo;
      window.scrollY = 0;
    }
  });

  it("opens a tote page and the add-tote form at the top, however far the grid was scrolled", async () => {
    seedTotes();
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.click(screen.getByRole("button", { name: "All totes" }));
      const list = await screen.findByRole("list", { name: "All totes" });

      // Deep in the All totes list; open a tote (no highlight)
      window.scrollY = 800;
      scrollTo.mockClear();
      await user.click(within(list).getByRole("button", { name: /Holiday Lights/ }));
      await screen.findByRole("heading", { name: "Holiday Lights" });
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      // Back lands where the list was
      window.scrollY = 0;
      scrollTo.mockClear();
      await user.click(screen.getByRole("button", { name: "Garage" }));
      await screen.findByRole("list", { name: "All totes" });
      expect(scrollTo).toHaveBeenLastCalledWith(0, 800);

      // Same for the add-tote form
      await user.click(screen.getByRole("button", { name: "Garage" }));
      window.scrollY = 300;
      scrollTo.mockClear();
      await user.click(
        await screen.findByRole("button", { name: "A1: empty slot, add a tote" })
      );
      await screen.findByRole("heading", { name: "New Tote" });
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
    } finally {
      window.scrollTo = originalScrollTo;
      window.scrollY = 0;
    }
  });

  it("clears the search when 'Show me' is used from a tote page", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText(/^B3: Camping Gear/);
    await user.type(screen.getByLabelText("Search totes and items"), "lantern");
    await user.click(await screen.findByRole("button", { name: /Lantern/ }));
    await screen.findByRole("heading", { name: "Camping Gear" });

    await user.click(screen.getByRole("button", { name: /Show me/ }));

    expect(await screen.findByLabelText("Search totes and items")).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
  });

  it("opens a tote, bumps a quantity, and persists the change", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    const slot = await screen.findByRole("button", {
      name: "B3: Camping Gear, 1 item",
    });
    await user.click(slot);

    expect(
      await screen.findByRole("heading", { name: "Camping Gear" })
    ).toBeInTheDocument();
    expect(screen.getByText("Lantern")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity: 2")).toBeInTheDocument();

    const addOne = screen.getByRole("button", { name: "Add one Lantern" });
    await user.click(addOne);

    expect(await screen.findByLabelText("Quantity: 3")).toBeInTheDocument();

    await waitFor(
      () => {
        const stored = readStore();
        const tote = stored.find((t) => t.id === 1);
        const item = tote?.items.find((i) => i.name === "Lantern");
        expect(item?.qty).toBe(3);
      },
      { timeout: 2500 }
    );
  });

  it("quick-adds an item from the detail page and persists it", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    const slot = await screen.findByRole("button", {
      name: "B3: Camping Gear, 1 item",
    });
    await user.click(slot);
    await screen.findByRole("heading", { name: "Camping Gear" });

    const quickAdd = screen.getByPlaceholderText("Add an item…");
    await user.type(quickAdd, "Rope{Enter}");

    expect(await screen.findByText("Rope")).toBeInTheDocument();

    await waitFor(
      () => {
        const stored = readStore();
        const tote = stored.find((t) => t.id === 1);
        expect(tote?.items.some((i) => i.name === "Rope")).toBe(true);
      },
      { timeout: 2500 }
    );
  });

  it("guards adding a tote to an empty slot until a name is entered", async () => {
    seedTotes();
    const user = userEvent.setup();
    render(<App />);

    const emptySlot = await screen.findByRole("button", {
      name: "A1: empty slot, add a tote",
    });
    await user.click(emptySlot);

    expect(
      await screen.findByRole("heading", { name: "New Tote" })
    ).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save Tote" });
    expect(saveButton).toBeDisabled();

    const nameInput = screen.getByLabelText("Tote name");
    await user.type(nameInput, "New Storage Bin");

    expect(saveButton).toBeEnabled();
  });
});
