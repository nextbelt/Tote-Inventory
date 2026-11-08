import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormPage from "../FormPage";

const store = vi.hoisted(() => ({
  saveTote: vi.fn(),
  updateTote: vi.fn(),
  updateItems: vi.fn(),
  recordRemovedItems: vi.fn(),
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
    // Like the service: the op is applied to the STORED list (here, the
    // list the form opened on) and the saved row comes back
    store.updateItems
      .mockReset()
      .mockImplementation(async (id, op) => ({ ...opened, items: op(opened.items) }));
    store.recordRemovedItems.mockReset().mockResolvedValue({});
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

  // ------ removed items → Recently deleted bin ------
  it("items taken off the list are recorded in the bin once the save landed (adds are not)", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Item name"), "Tape{Enter}");
    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(store.recordRemovedItems).toHaveBeenCalledTimes(1));
    expect(store.recordRemovedItems).toHaveBeenCalledWith(
      { id: 1, name: "Camping Gear", position: "B3" },
      [lantern]
    );
    // Recorded only after the item write succeeded
    expect(store.updateItems.mock.invocationCallOrder[0]).toBeLessThan(
      store.recordRemovedItems.mock.invocationCallOrder[0]
    );
  });

  it("records only what the op really removed from the STORED list, as stored — not the snapshot the form opened on", async () => {
    // While the form was open the other phone moved Lantern to another tote
    // and counted Rope up to 3; this phone's copy is still the old one
    store.updateItems.mockImplementation(async (id, op) => ({
      ...opened,
      items: op([{ ...rope, qty: 3 }]),
    }));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Remove Rope" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(store.recordRemovedItems).toHaveBeenCalledTimes(1));
    // Lantern wasn't here any more (restoring it would duplicate the copy in
    // the other tote); Rope is remembered with THEIR count, not the stale 1
    expect(store.recordRemovedItems).toHaveBeenCalledWith(
      { id: 1, name: "Camping Gear", position: "B3" },
      [{ ...rope, qty: 3 }]
    );
  });

  it("records nothing when every item taken off the list was already gone from the stored row", async () => {
    store.updateItems.mockImplementation(async (id, op) => ({ ...opened, items: op([rope]) }));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(store.updateItems).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.recordRemovedItems).not.toHaveBeenCalled();
  });

  it("matches removed items by their ORIGINAL id type: removing legacy item 7 never records item \"7\"", async () => {
    const legacy = { id: 7, name: "Old drill", qty: 1 };
    const impostor = { id: "7", name: "Impostor", qty: 1 };
    const mixed = { ...opened, items: [legacy, impostor] };
    store.updateItems.mockImplementation(async (id, op) => ({ ...mixed, items: op(mixed.items) }));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={mixed} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Remove Old drill" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(store.recordRemovedItems).toHaveBeenCalledTimes(1));
    expect(store.recordRemovedItems.mock.calls[0][1]).toEqual([legacy]);
    const [, op] = store.updateItems.mock.calls[0];
    expect(op([legacy, impostor])).toEqual([impostor]);
  });

  it("a rename alone, or adding items only, records nothing", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.clear(screen.getByLabelText("Tote name"));
    await user.type(screen.getByLabelText("Tote name"), "Renamed");
    await user.type(screen.getByLabelText("Item name"), "Tape{Enter}");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(store.updateItems).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.recordRemovedItems).not.toHaveBeenCalled();
  });

  it("nothing is recorded when the removal itself fails to save", async () => {
    store.updateItems.mockRejectedValueOnce(new Error("Couldn't save your changes. Please try again."));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(onSaved).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.recordRemovedItems).not.toHaveBeenCalled();
  });

  it("a failure to record is silent: the save still completes and no error is shown", async () => {
    store.recordRemovedItems.mockRejectedValue(new Error("bin unreachable"));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<FormPage editTote={opened} position="B3" onBack={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(store.recordRemovedItems).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
