import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormPage from "../FormPage";

const store = vi.hoisted(() => ({
  saveTote: vi.fn(),
  updateTote: vi.fn(),
  updateItems: vi.fn(),
  totesByPosition: {},
}));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => store }));
vi.mock("../../components/Toast", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("../../utils/images", () => ({ compressImage: async (file) => file }));
vi.mock("../../services/toteService", () => ({
  toteService: { uploadImage: async () => "https://img.test/photo.jpg" },
}));

const lantern ={ id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };
const opened = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [lantern, rope],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const renderNew = (onSaved = vi.fn()) =>
  render(<FormPage editTote={null} position="A1" onBack={vi.fn()} onSaved={onSaved} />);

describe("FormPage add-items box takes several items at once", () => {
  beforeEach(() => {
    store.saveTote.mockReset().mockResolvedValue({});
    store.updateTote.mockReset().mockResolvedValue({});
    store.updateItems.mockReset().mockResolvedValue({});
  });

  it("'3 bungee cords, tarp, 2 straps' becomes three items with quantities, saved with the tote", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderNew(onSaved);

    await user.type(screen.getByLabelText("Tote name"), "Straps Bin");
    await user.type(screen.getByLabelText("Item name"), "3 bungee cords, tarp, 2 straps");
    expect(screen.getByTestId("add-preview")).toHaveTextContent(
      "3 items: 3 x bungee cords, tarp, 2 x straps"
    );
    await user.click(screen.getByRole("button", { name: "Add 3 items" }));

    expect(screen.getByLabelText("Item name")).toHaveValue("");
    expect(screen.getByText("Items (3)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Tote" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [tote] = store.saveTote.mock.calls[0];
    expect(tote.items.map(({ name, qty }) => [name, qty])).toEqual([
      ["bungee cords", 3],
      ["tarp", 1],
      ["straps", 2],
    ]);
    expect(new Set(tote.items.map((i) => i.id)).size).toBe(3);
  });

  it("one item per line; Enter adds, Shift+Enter makes a new line", async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(
      screen.getByLabelText("Item name"),
      "hammer{Shift>}{Enter}{/Shift}2 saws{Enter}"
    );
    expect(screen.getByText("Items (2)")).toBeInTheDocument();
    expect(screen.getByText("hammer")).toBeInTheDocument();
    expect(screen.getByText("saws")).toBeInTheDocument();
  });

  it("a single item still works with the existing button label", async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText("Item name"), "Tape");
    expect(screen.queryByTestId("add-preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item to list" }));
    expect(screen.getByText("Items (1)")).toBeInTheDocument();
  });

  it("a photo is not attached to several items and stays in the box", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderNew(onSaved);

    await user.upload(
      screen.getByLabelText("Add photo"),
      new File(["x"], "tape.png", { type: "image/png" })
    );
    await screen.findByAltText("Preview of new item");
    await user.type(screen.getByLabelText("Item name"), "tape, glue");
    expect(screen.getByTestId("add-preview")).toHaveTextContent(
      /photo can only go on a single item/i
    );
    await user.click(screen.getByRole("button", { name: "Add 2 items" }));
    expect(screen.getByAltText("Preview of new item")).toBeInTheDocument(); // kept

    // ...and it still attaches to a single item afterwards
    await user.type(screen.getByLabelText("Item name"), "camera");
    await user.click(screen.getByRole("button", { name: "Add item to list" }));
    await user.type(screen.getByLabelText("Tote name"), "Bin");
    await user.click(screen.getByRole("button", { name: "Save Tote" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [tote] = store.saveTote.mock.calls[0];
    expect(tote.items.map((i) => [i.name, i.image])).toEqual([
      ["tape", null],
      ["glue", null],
      ["camera", "https://img.test/photo.jpg"],
    ]);
  });

  it("does not add on Enter while an IME is composing", async () => {
    renderNew();
    const input = screen.getByLabelText("Item name");
    fireEvent.change(input, { target: { value: "rope" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveValue("rope");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("");
    expect(screen.getByText("rope")).toBeInTheDocument();
  });

  it("an entry that is too long stays typed while the others are added", async () => {
    const user = userEvent.setup();
    renderNew();
    const long = "q".repeat(101);

    await user.click(screen.getByLabelText("Item name"));
    await user.paste(`rope, ${long}, tarp`);
    expect(screen.getByTestId("add-preview")).toHaveTextContent(/over 100 characters/);
    await user.click(screen.getByRole("button", { name: "Add 2 items" }));

    expect(screen.getByText("Items (2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Item name")).toHaveValue(long);
  });

  it("in edit mode the new items go through one add-by-id op", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Item name"), "tape x2; glue{Enter}");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(store.updateItems).toHaveBeenCalledTimes(1);
    const result = store.updateItems.mock.calls[0][1]([lantern, rope]);
    expect(result.slice(2).map(({ name, qty }) => [name, qty])).toEqual([
      ["tape", 2],
      ["glue", 1],
    ]);
  });
});
