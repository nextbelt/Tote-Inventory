import { render, screen, waitFor } from "@testing-library/react";
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

const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };
const opened = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [lantern, rope],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("FormPage (edit mode) saves only what changed", () => {
  beforeEach(() => {
    store.saveTote.mockReset().mockResolvedValue({});
    store.updateTote.mockReset().mockResolvedValue({});
    store.updateItems.mockReset().mockResolvedValue({});
  });

  it("renaming + adding/removing items never writes the items snapshot it opened with", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.clear(screen.getByLabelText("Tote name"));
    await user.type(screen.getByLabelText("Tote name"), "  Camp Kit ");
    await user.type(screen.getByLabelText("Item name"), "Tape");
    await user.click(screen.getByRole("button", { name: "Add item to list" }));
    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    // Name-only patch — no position, no items
    expect(store.updateTote).toHaveBeenCalledTimes(1);
    expect(store.updateTote).toHaveBeenCalledWith(1, { name: "Camp Kit" });
    expect(store.saveTote).not.toHaveBeenCalled();

    // Items go through the op path, diffed by id
    expect(store.updateItems).toHaveBeenCalledTimes(1);
    const [id, op] = store.updateItems.mock.calls[0];
    expect(id).toBe(1);
    expect(typeof op).toBe("function");

    // Meanwhile the other phone bumped Rope to 9 and added Glue — both survive
    const glue = { id: "i9", name: "Glue", qty: 1 };
    const result = op([lantern, { ...rope, qty: 9 }, glue]);
    expect(result.map((i) => i.name)).toEqual(["Rope", "Glue", "Tape"]);
    expect(result[0].qty).toBe(9);
    expect(result[2]).toMatchObject({ name: "Tape", qty: 1 });
  });

  it("saving without changes writes nothing", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(store.updateTote).not.toHaveBeenCalled();
    expect(store.updateItems).not.toHaveBeenCalled();
    expect(store.saveTote).not.toHaveBeenCalled();
  });

  it("a rename alone sends only the name", async () => {
    const user = userEvent.setup();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={vi.fn()} />);

    await user.clear(screen.getByLabelText("Tote name"));
    await user.type(screen.getByLabelText("Tote name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(store.updateTote).toHaveBeenCalledWith(1, { name: "Renamed" }));
    expect(store.updateItems).not.toHaveBeenCalled();
  });

  it("shows the save error and keeps the form open", async () => {
    store.updateTote.mockRejectedValueOnce(new Error("Couldn't save your changes. Please try again."));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.clear(screen.getByLabelText("Tote name"));
    await user.type(screen.getByLabelText("Tote name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("creating a new tote still inserts the whole tote", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={null} position="A1" onBack={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Tote name"), "New Bin");
    await user.type(screen.getByLabelText("Item name"), "Tape{Enter}");
    await user.click(screen.getByRole("button", { name: "Save Tote" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(store.saveTote).toHaveBeenCalledTimes(1);
    const [tote, isNew] = store.saveTote.mock.calls[0];
    expect(isNew).toBe(true);
    expect(tote).toMatchObject({ name: "New Bin", position: "A1" });
    expect(tote.items).toHaveLength(1);
    expect(store.updateTote).not.toHaveBeenCalled();
    expect(store.updateItems).not.toHaveBeenCalled();
  });
});
