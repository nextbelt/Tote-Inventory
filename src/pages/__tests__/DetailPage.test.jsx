import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DetailPage from "../DetailPage";

// A tiny live store standing in for ToteProvider: saves update it (like
// setTotes does) and the test can play the OTHER phone by replacing `totes`
// wholesale, exactly as a realtime refresh does.
const ext = vi.hoisted(() => {
  const listeners = new Set();
  let value = null;
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});
const toastMock = vi.hoisted(() => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("../../hooks/useTotes", async () => {
  const React = await import("react");
  return { useTotes: () => React.useSyncExternalStore(ext.subscribe, ext.get) };
});
vi.mock("../../components/Toast", () => ({ useToast: () => toastMock }));

const lantern = { id: "i1", name: "Lantern", qty: 2 };
const rope = { id: "i2", name: "Rope", qty: 1 };
const tote = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [lantern],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const props = {
  tote,
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onDeleted: vi.fn(),
  onShowInGarage: vi.fn(),
};

const updateItems = vi.fn();

/** The "database": a fake service applies each op to whatever it holds NOW,
 *  then the store picks up the saved row (as useTotes.updateItems does). */
function setup(items, { failWith } = {}) {
  const db = { items };
  updateItems.mockReset().mockImplementation(async (id, op) => {
    if (failWith) throw failWith;
    db.items = op(db.items);
    const saved = { ...tote, items: db.items, updated_at: new Date().toISOString() };
    ext.set((s) => ({ ...s, totes: [saved] }));
    return saved;
  });
  ext.set({
    totes: [{ ...tote, items }],
    totesByPosition: {},
    walls: [],
    updateItems,
    deleteTote: vi.fn(),
    moveTote: vi.fn(),
    restoreTote: vi.fn(),
  });
  /** Realtime refresh: the other phone changed the row. */
  const otherPhone = (nextItems) => {
    db.items = nextItems;
    act(() =>
      ext.set((s) => ({
        ...s,
        totes: [{ ...tote, items: nextItems, updated_at: new Date().toISOString() }],
      }))
    );
  };
  return { db, otherPhone };
}

describe("DetailPage keeps local edits as operations on top of the live store", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.error.mockReset();
  });

  it("a realtime refresh from the other phone doesn't wipe a staged +, and the + lands on top of their change", async () => {
    const { db, otherPhone } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument();
    expect(updateItems).not.toHaveBeenCalled(); // still debounced

    otherPhone([lantern, rope]); // they added Rope → our store refreshes wholesale

    expect(screen.getByText("Rope")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument(); // not wiped

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    // Saved as a delta applied to the fresh copy: both changes survive
    expect(db.items).toEqual([{ ...lantern, qty: 3 }, rope]);
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument();
    expect(screen.getByText("Rope")).toBeInTheDocument();
  });

  it("rapid +/- taps coalesce into one net delta", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    await user.click(screen.getByRole("button", { name: "Use one Lantern" }));
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument();

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(db.items[0].qty).toBe(3);
  });

  it("flushes staged taps on unmount through the op path (not a snapshot)", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    const view = render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    // The other phone changed the list while we were still on the page
    db.items = [lantern, rope];
    view.unmount();

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1));
    expect(db.items).toEqual([{ ...lantern, qty: 3 }, rope]);
  });

  it("tells the user when the unmount flush fails", async () => {
    setup([lantern], { failWith: new Error("Couldn't save your changes. Please try again.") });
    const user = userEvent.setup();
    const view = render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    view.unmount();

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/Your last change to “Camping Gear” didn't save/)
      )
    );
  });

  it("quick-add shows the item at once and saves it as an add-by-id op", async () => {
    const { db } = setup([lantern]);
    // Hold the save open so the optimistic overlay can be observed
    let finish;
    const pending = new Promise((r) => (finish = r));
    const real = updateItems.getMockImplementation();
    updateItems.mockImplementation(async (...args) => {
      await pending;
      return real(...args);
    });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(screen.getByPlaceholderText("Add an item…"), "Tape{Enter}");

    expect(await screen.findByText("Tape")).toBeInTheDocument(); // optimistic
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(db.items).toEqual([lantern]); // not saved yet

    // The op is add-by-id: on the other phone's copy nothing else is touched
    const op = updateItems.mock.calls[0][1];
    expect(op([lantern, rope]).map((i) => i.name)).toEqual(["Lantern", "Rope", "Tape"]);

    await act(async () => {
      finish();
      await pending;
    });
    await waitFor(() => expect(db.items.map((i) => i.name)).toEqual(["Lantern", "Tape"]));
    expect(screen.getByText("Tape")).toBeInTheDocument(); // now from the store
  });

  it("remove → Undo restores by id at its old index, after landing any staged taps first", async () => {
    const { db } = setup([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1
    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));

    await waitFor(() => expect(screen.queryByText("Lantern")).not.toBeInTheDocument());
    expect(toastMock.show).toHaveBeenCalledTimes(1);
    const [, opts] = toastMock.show.mock.calls[0];
    expect(opts.actionLabel).toBe("Undo");

    // The staged +1 was flushed before the remove (so Undo restores qty 3)
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(db.items).toEqual([rope]);

    // Meanwhile the other phone added Glue; Undo must not clobber it
    const glue = { id: "i3", name: "Glue", qty: 1 };
    db.items = [rope, glue];
    await act(async () => {
      opts.onAction();
    });

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(3));
    expect(db.items).toEqual([{ ...lantern, qty: 3 }, rope, glue]);
    expect(await screen.findByText("Lantern")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument();
  });

  it("saves staged taps immediately when the app goes to the background (phone locked / app swiped away)", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    expect(updateItems).not.toHaveBeenCalled(); // still inside the debounce

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      // Saved right away — no waiting for the 700 ms debounce
      expect(updateItems).toHaveBeenCalledTimes(1);
      expect(db.items).toEqual([{ ...lantern, qty: 3 }]);

      // A following pagehide finds nothing left to save (no double-apply)
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
      });
      expect(updateItems).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
    }
  });

  it("holds staged taps while a delete is in flight, then drops them (no bogus 'couldn't find' error)", async () => {
    setup([lantern]);
    let finishDelete;
    const deleting = new Promise((r) => (finishDelete = r));
    const deleteTote = vi.fn(() => deleting);
    ext.set((s) => ({ ...s, deleteTote }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1
    await user.click(screen.getByRole("button", { name: "Delete tote" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteTote).toHaveBeenCalledWith(1);

    // Well past the debounce while the delete is still in flight: nothing saves
    await new Promise((r) => setTimeout(r, 900));
    expect(updateItems).not.toHaveBeenCalled();

    await act(async () => {
      finishDelete();
      await deleting;
    });
    expect(props.onDeleted).toHaveBeenCalled();
    // The Undo snapshot carries the staged +1
    const [, opts] = toastMock.show.mock.calls.at(-1);
    expect(opts.actionLabel).toBe("Undo");
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("saves the held taps if the delete fails", async () => {
    const { db } = setup([lantern]);
    const deleteTote = vi.fn(async () => {
      throw new Error("Couldn't delete that tote. Please try again.");
    });
    ext.set((s) => ({ ...s, deleteTote }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    await user.click(screen.getByRole("button", { name: "Delete tote" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete that tote. Please try again.")
    );
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(db.items).toEqual([{ ...lantern, qty: 3 }]);
  });

  it("shows the service's friendly error when an op fails and drops the optimistic overlay", async () => {
    setup([lantern], { failWith: new Error("Couldn't save your changes. Please try again.") });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(screen.getByPlaceholderText("Add an item…"), "Tape{Enter}");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't save your changes. Please try again.")
    );
    await waitFor(() => expect(screen.queryByText("Tape")).not.toBeInTheDocument());
  });
});
