import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Photo picking: compress + upload are stubbed, upload returns a fixed URL
const imageMock = vi.hoisted(() => ({
  compress: vi.fn(async (file) => file),
  upload: vi.fn(async () => "https://img.test/photo.jpg"),
}));
vi.mock("../../utils/images", () => ({ compressImage: imageMock.compress }));
vi.mock("../../services/toteService", () => ({
  toteService: { uploadImage: imageMock.upload },
}));

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
    // Until the owners run the setup SQL nothing optional is available
    capabilities: { tags: false, notes: false, swap: false },
    updateItems,
    updateTote: vi.fn(),
    deleteTote: vi.fn(),
    moveTote: vi.fn(),
    restoreTote: vi.fn(),
    swapTotes: vi.fn(),
    recordRemovedItems: vi.fn().mockResolvedValue(null),
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

const box = () => screen.getByPlaceholderText("Add an item…");

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
    const restoreTote = vi.fn().mockResolvedValue(tote);
    ext.set((s) => ({ ...s, deleteTote, restoreTote }));
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
    const [, opts] = toastMock.show.mock.calls.at(-1);
    expect(opts.actionLabel).toBe("Undo");
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();

    // Undo hands restoreTote the tote's ID (so the SAME row comes back, not
    // a re-created one) together with the staged +1
    await act(async () => {
      await opts.onAction();
    });
    expect(restoreTote).toHaveBeenCalledTimes(1);
    const snapshot = restoreTote.mock.calls[0][0];
    expect(snapshot).toMatchObject({ id: 1, name: "Camping Gear", position: "B3" });
    expect(snapshot.items).toEqual([expect.objectContaining({ id: "i1", qty: 3 })]);
  });

  /** Start a delete that stays in flight until the test settles it. */
  async function startPendingDelete(user) {
    let settle;
    const deleting = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const deleteTote = vi.fn(() => deleting);
    ext.set((s) => ({ ...s, deleteTote }));
    await user.click(screen.getByRole("button", { name: "Delete tote" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteTote).toHaveBeenCalledWith(1);
    return { settle, deleting };
  }

  it("holds the taps while the delete is pending and saves them only once it fails", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    const { settle, deleting } = await startPendingDelete(user);

    await new Promise((r) => setTimeout(r, 900)); // past the debounce
    expect(updateItems).not.toHaveBeenCalled(); // held, not saved

    await act(async () => {
      settle.reject(new Error("Couldn't delete that tote. Please try again."));
      await deleting.catch(() => {});
    });
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete that tote. Please try again.");
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(db.items).toEqual([{ ...lantern, qty: 3 }]);
  });

  it("locking the phone mid-delete doesn't save the held taps", async () => {
    setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    const { settle, deleting } = await startPendingDelete(user);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pagehide"));
      });
    } finally {
      visibility.mockRestore();
    }
    expect(updateItems).not.toHaveBeenCalled();

    await act(async () => {
      settle.resolve();
      await deleting;
    });
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("a tap made while the delete is in flight is held too", async () => {
    setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    const { settle, deleting } = await startPendingDelete(user);
    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));

    await new Promise((r) => setTimeout(r, 900)); // past the debounce
    expect(updateItems).not.toHaveBeenCalled();

    await act(async () => {
      settle.resolve();
      await deleting;
    });
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("pagehide on its own also saves staged taps right away", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(db.items).toEqual([{ ...lantern, qty: 3 }]);
  });

  it("stops listening for background events once the page is gone", async () => {
    setup([lantern]);
    const user = userEvent.setup();
    const view = render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    view.unmount(); // the unmount flush saves the tap once
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1));

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    } finally {
      visibility.mockRestore();
    }
    expect(updateItems).toHaveBeenCalledTimes(1);
  });

  // ------ edit an item ------
  it("tapping an item's name opens the edit sheet; staged +/- taps are flushed BEFORE the exact count lands (no double-apply)", async () => {
    const { db } = setup([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1 → 3
    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));

    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).getByLabelText("Count")).toHaveValue(3); // current, not stale
    // Opening the sheet landed the staged tap already
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(db.items[0].qty).toBe(3);

    await user.clear(within(dialog).getByLabelText("Count"));
    await user.type(within(dialog).getByLabelText("Count"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit item" })).not.toBeInTheDocument());
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    // Exact count: 5, never 3+1 or 5+1
    expect(db.items).toEqual([{ ...lantern, qty: 5 }, rope]);
    expect(screen.getByLabelText("Quantity: 5")).toBeInTheDocument();

    // Only the changed field travelled — the other phone's rename survives
    const op = updateItems.mock.calls[1][1];
    expect(op([{ ...lantern, name: "Lamp", qty: 9 }])).toEqual([{ ...lantern, name: "Lamp", qty: 5 }]);

    // Undo restores the count as it was shown when the sheet opened (3)
    const [msg, opts] = toastMock.show.mock.calls.at(-1);
    expect(msg).toBe("Updated “Lantern”");
    expect(opts.actionLabel).toBe("Undo");
    await act(async () => {
      opts.onAction();
    });
    await waitFor(() => expect(db.items[0].qty).toBe(3));
  });

  it("an exact count DROPS a staged tap for that item instead of landing it (the count shown already included it)", async () => {
    const { db } = setup([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    // Not reachable through the modal, but guard the ordering regardless:
    // a tap on Lantern (being edited) and one on Rope (not)
    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    await user.click(screen.getByRole("button", { name: "Add one Rope" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.clear(within(dialog).getByLabelText("Count"));
    await user.type(within(dialog).getByLabelText("Count"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // Rope's tap is flushed first, then the absolute set; Lantern's tap is
    // dropped, never saved — so it can't land after the set either
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(updateItems.mock.calls[0][1]([lantern, rope])).toEqual([lantern, { ...rope, qty: 2 }]);
    expect(db.items).toEqual([{ ...lantern, qty: 10 }, { ...rope, qty: 2 }]);
    await new Promise((r) => setTimeout(r, 900)); // past the debounce
    expect(updateItems).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Quantity: 10")).toBeInTheDocument();
  });

  it("a rename alone still lets a staged tap on that item land (no exact count involved)", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.click(screen.getByRole("button", { name: "Add one Lantern" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Lamp");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(db.items).toEqual([{ ...lantern, name: "Lamp", qty: 3 }]);
  });

  // ------ nothing but held +/- taps may start while a delete is in flight ------
  it("mid-delete: tapping a name or Remove does nothing but say so; a held tap still saves alone once the delete fails", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1 → 3
    const { settle, deleting } = await startPendingDelete(user);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    expect(screen.queryByRole("dialog", { name: "Edit item" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    expect(screen.getByText("Lantern")).toBeInTheDocument();
    expect(toastMock.show).toHaveBeenCalledWith("Deleting “Camping Gear”…");
    expect(updateItems).not.toHaveBeenCalled();

    await act(async () => {
      settle.reject(new Error("Couldn't delete that tote. Please try again."));
      await deleting.catch(() => {});
    });
    // Only the held +1 lands — no remove, no stray edit
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(db.items).toEqual([{ ...lantern, qty: 3 }]);
  });

  it("mid-delete: an exact count typed into an already-open sheet is refused, so the held tap can't land on top of it (reviewer scenario: 3 shown, set 5, delete fails)", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    // Behind the modal (not reachable on a phone, but the ordering must hold)
    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1 → 3
    const { settle, deleting } = await startPendingDelete(user);
    expect(updateItems).not.toHaveBeenCalled(); // the tap is held

    await user.clear(within(dialog).getByLabelText("Count"));
    await user.type(within(dialog).getByLabelText("Count"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", { name: "Edit item" })).not.toBeInTheDocument();
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.show).toHaveBeenCalledWith(
      "Deleting “Camping Gear”, so the change to “Lantern” wasn't saved."
    );

    await act(async () => {
      settle.reject(new Error("Couldn't delete that tote. Please try again."));
      await deleting.catch(() => {});
    });
    // Never 6 (5 + the held tap): the held tap lands alone, the refused set does not
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(db.items).toEqual([{ ...lantern, qty: 3 }]);
    expect(screen.getByLabelText("Quantity: 3")).toBeInTheDocument();
  });

  it("mid-delete: Move to another tote is refused too", async () => {
    setup([lantern]);
    ext.set((s) => ({
      ...s,
      totesByPosition: { B3: { ...tote, items: [lantern] }, A1: { id: 2, name: "Paint", position: "A1", items: [] } },
    }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    const { settle, deleting } = await startPendingDelete(user);
    await user.click(screen.getByRole("button", { name: /Move to another tote/ }));
    expect(screen.queryByRole("dialog", { name: /Move “Lantern” to/ })).not.toBeInTheDocument();
    expect(toastMock.show).toHaveBeenCalledWith("Deleting “Camping Gear”…");

    await act(async () => {
      settle.resolve();
      await deleting;
    });
    expect(updateItems).not.toHaveBeenCalled();
    expect(props.onDeleted).toHaveBeenCalled();
  });

  it("renaming saves through updateItem and Undo brings the old name back", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Big lantern");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Big lantern")).toBeInTheDocument();
    await waitFor(() => expect(db.items).toEqual([{ ...lantern, name: "Big lantern" }]));
    expect(toastMock.show).toHaveBeenCalledWith("Updated “Big lantern”", expect.objectContaining({ actionLabel: "Undo" }));

    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      opts.onAction();
    });
    expect(await screen.findByText("Lantern")).toBeInTheDocument();
    expect(db.items).toEqual([lantern]);
  });

  it("Cancel in the edit sheet saves nothing; Save with no changes saves nothing", async () => {
    setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.type(screen.getByLabelText("Name"), " x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateItems).not.toHaveBeenCalled();
    expect(toastMock.show).not.toHaveBeenCalled();
  });

  it("tells the user when the item was removed on the other phone before the save landed", async () => {
    const { db, otherPhone } = setup([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.clear(within(dialog).getByLabelText("Count"));
    await user.type(within(dialog).getByLabelText("Count"), "4");
    otherPhone([rope]); // they removed the lantern meanwhile
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/“Lantern” was removed on the other phone/))
    );
    expect(db.items).toEqual([rope]); // the no-op op added nothing back
    expect(toastMock.show).not.toHaveBeenCalled(); // no bogus Undo
  });

  // ------ move an item to another tote ------
  const paint = {
    id: 2,
    name: "Paint",
    position: "C4",
    items: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  /** Two totes in the fake database; ops are applied to whichever id is named. */
  function setupTwoTotes(sourceItems, { failRemoveFromSource = false, failRemoveFromDest = false } = {}) {
    setup(sourceItems);
    const dbs = { 1: { items: sourceItems }, 2: { items: [] } };
    const rows = () => [
      { ...tote, items: dbs[1].items },
      { ...paint, items: dbs[2].items },
    ];
    updateItems.mockReset().mockImplementation(async (id, op) => {
      const before = dbs[id].items;
      const after = op(before);
      const isRemove = after.length < before.length;
      if (isRemove && id === 1 && failRemoveFromSource) throw new Error("Couldn't save your changes. Please try again.");
      if (isRemove && id === 2 && failRemoveFromDest) throw new Error("Couldn't save your changes. Please try again.");
      dbs[id].items = after;
      const saved = { ...rows().find((t) => t.id === id), updated_at: new Date().toISOString() };
      ext.set((s) => ({ ...s, totes: rows() }));
      return saved;
    });
    ext.set((s) => ({ ...s, totes: rows(), totesByPosition: { B3: rows()[0], C4: rows()[1] } }));
    /** Realtime refresh: the other phone changed the SOURCE tote. */
    const otherPhone = (nextSourceItems) => {
      dbs[1].items = nextSourceItems;
      act(() => ext.set((s) => ({ ...s, totes: rows() })));
    };
    return { dbs, otherPhone };
  }

  async function moveLanternToPaint(user) {
    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.click(screen.getByRole("button", { name: /Move to another tote/ }));
    const picker = screen.getByRole("dialog", { name: "Move “Lantern” to…" });
    expect(within(picker).queryByText("Camping Gear")).not.toBeInTheDocument(); // only OTHER totes
    await user.click(within(picker).getByRole("button", { name: /Paint/ }));
  }

  it("moves an item by adding it to the destination FIRST, then removing it here; keeps id, name, photo and qty", async () => {
    const photoLantern = { ...lantern, image: "https://cdn/l.jpg", qty: 3 };
    const { dbs } = setupTwoTotes([photoLantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(updateItems.mock.calls[0][0]).toBe(2); // add to Paint first
    expect(updateItems.mock.calls[1][0]).toBe(1); // then remove from here
    expect(dbs[2].items).toEqual([photoLantern]);
    expect(dbs[1].items).toEqual([rope]);
    await waitFor(() => expect(screen.queryByText("Lantern")).not.toBeInTheDocument());
    expect(toastMock.show).toHaveBeenCalledWith("Moved “Lantern” to “Paint”", expect.objectContaining({ actionLabel: "Undo" }));
  });

  it("flushes a staged tap for the item before moving, so the moved copy carries the quantity you saw", async () => {
    const { dbs } = setupTwoTotes([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // 2 → 3, staged
    await moveLanternToPaint(user);

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(3));
    expect(updateItems.mock.calls.map((c) => c[0])).toEqual([1, 2, 1]); // flush, add, remove
    expect(dbs[2].items).toEqual([{ ...lantern, qty: 3 }]);
    expect(dbs[1].items).toEqual([]);
  });

  it("moves the item AS IT IS NOW, not the snapshot the sheet opened on — a count change from the other phone travels with it", async () => {
    const { dbs, otherPhone } = setupTwoTotes([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    expect(screen.getByLabelText("Count")).toHaveValue(2);
    // The other phone renames it and uses one while the sheet is open
    otherPhone([{ ...lantern, name: "Lamp", qty: 1 }, rope]);
    await user.click(screen.getByRole("button", { name: /Move to another tote/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Paint/ }));

    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(dbs[2].items).toEqual([{ ...lantern, name: "Lamp", qty: 1 }]); // their edit kept
    expect(dbs[1].items).toEqual([rope]);
    expect(toastMock.show).toHaveBeenCalledWith("Moved “Lamp” to “Paint”", expect.objectContaining({ actionLabel: "Undo" }));

    // Undo puts back the copy that actually moved
    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      await opts.onAction();
    });
    expect(dbs[1].items).toEqual([{ ...lantern, name: "Lamp", qty: 1 }, rope]);
    expect(dbs[2].items).toEqual([]);
  });

  it("does not revive an item the other phone removed while the sheet or picker was open", async () => {
    const { dbs, otherPhone } = setupTwoTotes([lantern, rope]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.click(screen.getByRole("button", { name: /Move to another tote/ }));
    otherPhone([rope]); // they removed the lantern meanwhile
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Paint/ }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/“Lantern” was removed on the other phone/))
    );
    expect(updateItems).not.toHaveBeenCalled(); // nothing written anywhere
    expect(dbs[2].items).toEqual([]);
    expect(dbs[1].items).toEqual([rope]);
    expect(toastMock.show).not.toHaveBeenCalled(); // no bogus "Moved" + Undo
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the row here while the add to the destination is still pending, so nothing can be done to the copy about to be removed", async () => {
    const { dbs } = setupTwoTotes([lantern, rope]);
    const real = updateItems.getMockImplementation();
    let finishAdd;
    updateItems.mockImplementation(async (id, op) => {
      if (id === 2) await new Promise((resolve) => (finishAdd = resolve));
      return real(id, op);
    });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);

    // Step 1 is in flight: the row is already gone from this list
    await waitFor(() => expect(screen.queryByText("Lantern")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add one Lantern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Lantern" })).not.toBeInTheDocument();
    expect(screen.getByText("Rope")).toBeInTheDocument();
    expect(screen.getByText("Items (1)")).toBeInTheDocument();
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(dbs[1].items).toEqual([lantern, rope]); // not removed yet — only hidden

    await act(async () => {
      finishAdd();
    });
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(dbs[2].items).toEqual([lantern]);
    expect(dbs[1].items).toEqual([rope]);
    // …and it never flickered back: still hidden once the remove has landed
    expect(screen.queryByText("Lantern")).not.toBeInTheDocument();
    expect(toastMock.show).toHaveBeenCalledWith("Moved “Lantern” to “Paint”", expect.objectContaining({ actionLabel: "Undo" }));
  });

  it("when the add to the destination fails the row comes straight back here and the service error is shown", async () => {
    const { dbs } = setupTwoTotes([lantern]);
    const real = updateItems.getMockImplementation();
    let failAdd;
    updateItems.mockImplementation(async (id, op) => {
      if (id === 2) {
        await new Promise((_, reject) => (failAdd = reject));
      }
      return real(id, op);
    });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);
    await waitFor(() => expect(screen.queryByText("Lantern")).not.toBeInTheDocument()); // hidden while pending

    await act(async () => {
      failAdd(new Error("Couldn't save your changes. Please try again."));
    });

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't save your changes. Please try again."));
    expect(updateItems).toHaveBeenCalledTimes(1); // no remove attempted
    expect(dbs[1].items).toEqual([lantern]);
    expect(dbs[2].items).toEqual([]);
    expect(await screen.findByText("Lantern")).toBeInTheDocument(); // overlay dropped at once
    expect(screen.getByRole("button", { name: "Add one Lantern" })).toBeInTheDocument();
    expect(toastMock.show).not.toHaveBeenCalled();
  });

  it("when the remove from here fails after the add succeeded, says the item is now in both totes", async () => {
    const { dbs } = setupTwoTotes([lantern], { failRemoveFromSource: true });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/added to “Paint” but couldn't be removed from “Camping Gear” — it is now in both/))
    );
    expect(dbs[2].items).toEqual([lantern]); // never lost
    expect(dbs[1].items).toEqual([lantern]);
    expect(screen.getByText("Lantern")).toBeInTheDocument(); // overlay dropped, still here
    expect(toastMock.show).not.toHaveBeenCalled(); // no Undo for a half-done move
  });

  it("Undo puts the item back here at its old index FIRST, then removes it from the destination", async () => {
    const { dbs } = setupTwoTotes([rope, lantern, { id: "i3", name: "Glue", qty: 1 }]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(dbs[1].items.map((i) => i.name)).toEqual(["Rope", "Glue"]);

    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      await opts.onAction();
    });

    expect(updateItems).toHaveBeenCalledTimes(4);
    expect(updateItems.mock.calls[2][0]).toBe(1); // restore here first
    expect(updateItems.mock.calls[3][0]).toBe(2); // then remove from Paint
    expect(dbs[1].items.map((i) => i.name)).toEqual(["Rope", "Lantern", "Glue"]);
    expect(dbs[2].items).toEqual([]);
    expect(await screen.findByText("Lantern")).toBeInTheDocument();
  });

  it("moving an item to another tote never records it in the removed-items bin (it lives on over there)", async () => {
    const { dbs } = setupTwoTotes([lantern, rope]);
    const recordRemovedItems = vi.fn().mockResolvedValue({});
    ext.set((s) => ({ ...s, recordRemovedItems }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    expect(dbs[2].items).toEqual([lantern]);
    await new Promise((r) => setTimeout(r, 20));
    expect(recordRemovedItems).not.toHaveBeenCalled();
  });

  it("Undo whose second step fails says the item is now in both totes (never lost)", async () => {
    const { dbs } = setupTwoTotes([lantern], { failRemoveFromDest: true });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await moveLanternToPaint(user);
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(2));
    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      await opts.onAction();
    });

    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringMatching(/back in “Camping Gear” but couldn't be removed from “Paint” — it is now in both/)
    );
    expect(dbs[1].items).toEqual([lantern]);
    expect(dbs[2].items).toEqual([lantern]);
  });

  // ------ highlight (opened from search) ------
  it("highlightItemId scrolls that row into view and pulses it briefly", async () => {
    setup([lantern, rope]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const view = render(<DetailPage {...props} highlightItemId="i2" />);

    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    const ropeRow = screen.getByText("Rope").closest("li");
    expect(scroll.mock.instances[0]).toBe(ropeRow);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(ropeRow).toHaveClass("item-highlight");
    expect(screen.getByText("Lantern").closest("li")).not.toHaveClass("item-highlight");

    // Changing the target highlights the new row
    view.rerender(<DetailPage {...props} highlightItemId="i1" />);
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
    expect(scroll.mock.instances[1]).toBe(screen.getByText("Lantern").closest("li"));
    expect(screen.getByText("Lantern").closest("li")).toHaveClass("item-highlight");
    expect(ropeRow).not.toHaveClass("item-highlight");
  });

  it("highlight matches the ORIGINAL id value — a numeric legacy id is not matched by its string form", async () => {
    const legacy = { id: 7, name: "Old drill" };
    setup([legacy, { id: "7", name: "Impostor", qty: 1 }]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<DetailPage {...props} highlightItemId={7} />);

    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.instances[0]).toBe(screen.getByText("Old drill").closest("li"));
    expect(screen.getByText("Impostor").closest("li")).not.toHaveClass("item-highlight");
  });

  it("without highlightItemId nothing scrolls and no row is highlighted", async () => {
    setup([lantern]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<DetailPage {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector(".item-highlight")).toBeNull();
  });

  it("shows the service's friendly error when an op fails and drops the optimistic overlay", async () => {
    setup([lantern], { failWith: new Error("Couldn't save your changes. Please try again.") });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(screen.getByPlaceholderText("Add an item…"), "Tape{Enter}");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Couldn't save your changes. Please try again.",
        expect.objectContaining({ actionLabel: "Retry" })
      )
    );
    // The optimistic row is gone (the typed text is back in the box instead)
    await waitFor(() => expect(screen.getByText("Items (1)")).toBeInTheDocument());
    expect(box()).toHaveValue("Tape");
  });
});

describe("DetailPage quick-add: several items at once", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.error.mockReset();
    imageMock.compress.mockClear();
    imageMock.upload.mockClear();
  });

  it("adds '3 bungee cords, tarp, 2 straps' in ONE updateItems call with the right quantities", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(box(), "3 bungee cords, tarp, 2 straps");
    expect(screen.getByRole("button", { name: "Add 3 items" })).toHaveTextContent("Add 3 items");
    expect(screen.getByTestId("add-preview")).toHaveTextContent(
      "3 items: 3 x bungee cords, tarp, 2 x straps"
    );
    await user.click(screen.getByRole("button", { name: "Add 3 items" }));

    await waitFor(() => expect(db.items).toHaveLength(4));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(db.items.slice(1).map(({ name, qty }) => [name, qty])).toEqual([
      ["bungee cords", 3],
      ["tarp", 1],
      ["straps", 2],
    ]);
    const ids = db.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
    expect(box()).toHaveValue("");
    expect(screen.queryByTestId("add-preview")).not.toBeInTheDocument();
  });

  it("adds one item per line (Shift+Enter makes a new line, Enter adds)", async () => {
    const { db } = setup([]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(box(), "hammer{Shift>}{Enter}{/Shift}saw{Shift>}{Enter}{/Shift}2 clamps");
    expect(box()).toHaveValue("hammer\nsaw\n2 clamps");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(db.items).toHaveLength(3));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(db.items.map((i) => [i.name, i.qty])).toEqual([
      ["hammer", 1],
      ["saw", 1],
      ["clamps", 2],
    ]);
  });

  it("does not add on Enter while an IME is composing", async () => {
    const { db } = setup([]);
    render(<DetailPage {...props} />);

    fireEvent.change(box(), { target: { value: "rope" } });
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(updateItems).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(db.items).toHaveLength(1));
  });

  it("grows to show a long comma-separated entry instead of hiding its wrapped lines", async () => {
    // jsdom does no layout: pretend each 30 characters wrap onto another 24px
    // line, plus 24px of padding
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 24 + 24 * Math.ceil(Math.max(1, this.value.length) / 30);
      },
    });
    try {
      setup([]);
      render(<DetailPage {...props} />);
      expect(box().style.height).toBe("48px");
      fireEvent.change(box(), {
        target: { value: "3 bungee cords, tarp, 2 straps, hammer" },
      });
      expect(box().style.height).toBe("72px");
      expect(box()).toHaveValue("3 bungee cords, tarp, 2 straps, hammer");
    } finally {
      delete HTMLTextAreaElement.prototype.scrollHeight;
    }
  });

  it("a multi-add is an add-by-id op that survives the other phone's changes", async () => {
    setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(box(), "tarp; rope{Enter}");
    await waitFor(() => expect(updateItems).toHaveBeenCalledTimes(1));
    const op = updateItems.mock.calls[0][1];
    const theirs = { id: 7, name: "Glue", qty: 1 }; // legacy numeric id
    const result = op([lantern, theirs]);
    expect(result.map((i) => i.name)).toEqual(["Lantern", "Glue", "tarp", "rope"]);
    expect(result[1].id).toBe(7); // original id value kept
    // Re-applying (lost compare-and-swap race) doesn't duplicate
    expect(op(result)).toHaveLength(4);
  });

  it("single-item add is unchanged: the photo goes on it and qty is 1", async () => {
    const { db } = setup([lantern]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.upload(
      screen.getByLabelText("Add photo"),
      new File(["x"], "tape.png", { type: "image/png" })
    );
    expect(await screen.findByText("Photo attached")).toBeInTheDocument();
    await user.type(box(), "Tape");
    expect(screen.queryByTestId("add-preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() => expect(db.items).toHaveLength(2));
    expect(db.items[1]).toMatchObject({
      name: "Tape",
      qty: 1,
      image: "https://img.test/photo.jpg",
    });
    expect(screen.queryByText("Photo attached")).not.toBeInTheDocument();
  });

  it("a single item with a count gets that quantity", async () => {
    const { db } = setup([]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.type(box(), "tarp x2.{Enter}");
    await waitFor(() => expect(db.items).toHaveLength(1));
    expect(db.items[0]).toMatchObject({ name: "tarp", qty: 2 });
  });

  it("a photo is not attached to several items and stays in the box", async () => {
    const { db } = setup([]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.upload(
      screen.getByLabelText("Add photo"),
      new File(["x"], "tape.png", { type: "image/png" })
    );
    await screen.findByText("Photo attached");
    await user.type(box(), "tape, glue");
    expect(screen.getByTestId("add-preview")).toHaveTextContent(/photo can only go on a single item/i);
    await user.click(screen.getByRole("button", { name: "Add 2 items" }));

    await waitFor(() => expect(db.items).toHaveLength(2));
    expect(db.items.every((i) => !i.image)).toBe(true);
    expect(screen.getByText("Photo attached")).toBeInTheDocument(); // not lost
  });

  it("an over-long entry stays in the box while the rest are added", async () => {
    const { db } = setup([]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);
    const long = "z".repeat(101);

    await user.click(box());
    await user.paste(`rope, ${long}, tarp`);
    expect(screen.getByTestId("add-preview")).toHaveTextContent(/over 100 characters/);
    await user.click(screen.getByRole("button", { name: "Add 2 items" }));

    await waitFor(() => expect(db.items.map((i) => i.name)).toEqual(["rope", "tarp"]));
    expect(box()).toHaveValue(long);
  });

  it("only the first 50 are added; the rest stay typed", async () => {
    const { db } = setup([]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(box());
    await user.paste(Array.from({ length: 52 }, (_, i) => `i${i + 1}`).join(", "));
    await user.click(screen.getByRole("button", { name: "Add 50 items" }));

    await waitFor(() => expect(db.items).toHaveLength(50));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue("i51\ni52");
  });

  describe("when the save fails", () => {
    const failure = new Error("Couldn't save your changes. Please try again.");

    it("puts the text and photo back and offers Retry, which re-runs the same add", async () => {
      const { db } = setup([lantern], { failWith: failure });
      const user = userEvent.setup();
      render(<DetailPage {...props} />);

      await user.upload(
        screen.getByLabelText("Add photo"),
        new File(["x"], "tape.png", { type: "image/png" })
      );
      await screen.findByText("Photo attached");
      await user.type(box(), "2 tape.{Enter}");

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
      expect(box()).toHaveValue("2 tape");
      expect(screen.getByText("Photo attached")).toBeInTheDocument();
      expect(screen.queryByText("tape")).not.toBeInTheDocument(); // overlay dropped
      const [message, opts] = toastMock.error.mock.calls[0];
      expect(message).toBe(failure.message);
      expect(opts.actionLabel).toBe("Retry");

      // Back online: Retry runs the very same op
      updateItems.mockImplementation(async (id, op) => {
        db.items = op(db.items);
        ext.set((s) => ({ ...s, totes: [{ ...tote, items: db.items }] }));
      });
      const failedOp = updateItems.mock.calls[0][1];
      await act(async () => {
        opts.onAction();
      });

      await waitFor(() => expect(db.items).toHaveLength(2));
      expect(db.items[1]).toMatchObject({
        name: "tape",
        qty: 2,
        image: "https://img.test/photo.jpg",
      });
      expect(updateItems.mock.calls[1][1]).toBe(failedOp);
      // Restored draft is cleared so it isn't added twice
      expect(box()).toHaveValue("");
      expect(screen.queryByText("Photo attached")).not.toBeInTheDocument();
    });

    it("keeps what was typed since and does not duplicate on Retry", async () => {
      const { db } = setup([], { failWith: failure });
      const user = userEvent.setup();
      render(<DetailPage {...props} />);

      await user.type(box(), "rope, tarp{Enter}");
      await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
      expect(box()).toHaveValue("rope\ntarp");

      await user.type(box(), "{Shift>}{Enter}{/Shift}glue");
      expect(box()).toHaveValue("rope\ntarp\nglue");

      updateItems.mockImplementation(async (id, op) => {
        db.items = op(db.items);
        ext.set((s) => ({ ...s, totes: [{ ...tote, items: db.items }] }));
      });
      await act(async () => {
        toastMock.error.mock.calls[0][1].onAction();
      });
      await waitFor(() => expect(db.items.map((i) => i.name)).toEqual(["rope", "tarp"]));
      expect(box()).toHaveValue("glue");
    });

    it("a failing Retry restores the box and offers Retry again", async () => {
      setup([], { failWith: failure });
      const user = userEvent.setup();
      render(<DetailPage {...props} />);

      await user.type(box(), "rope, tarp{Enter}");
      await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
      await act(async () => {
        toastMock.error.mock.calls[0][1].onAction();
      });
      await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(2));
      expect(toastMock.error.mock.calls[1][1].actionLabel).toBe("Retry");
      expect(box()).toHaveValue("rope\ntarp");
    });
  });
});

// ---------------------------------------------------------------------------
// U1: tote notes, tags, swap, delete → bin, removed items → bin, item notes
// ---------------------------------------------------------------------------
describe("DetailPage tote notes, tags, swap and the bins", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.error.mockReset();
  });

  const caps = (over) => ({ tags: false, notes: false, swap: false, ...over });

  /** updateTote that patches the row in the fake store (like the hook does). */
  function fakeUpdateTote() {
    return vi.fn(async (id, fields) => {
      let saved;
      ext.set((s) => {
        const totes = s.totes.map((t) =>
          t.id === id ? { ...t, ...fields, updated_at: new Date().toISOString() } : t
        );
        saved = totes.find((t) => t.id === id);
        return { ...s, totes };
      });
      return saved;
    });
  }

  // ------ capability gating ------
  it("hides the tags and notes UI entirely while the database lacks the columns, even if the row carries values", () => {
    setup([lantern]);
    ext.set((s) => ({
      ...s,
      totes: [{ ...tote, items: [lantern], tags: ["winter"], notes: "Fragile glass" }],
    }));
    render(<DetailPage {...props} />);

    expect(screen.queryByRole("button", { name: /Add tag|Edit tags/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText("winter")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a note|Edit note/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Fragile glass")).not.toBeInTheDocument();
  });

  // ------ notes ------
  it("notes: 'Add a note' → type → Save sends updateTote(id, { notes }) and shows the saved text; clearing saves null", async () => {
    setup([lantern]);
    const updateTote = fakeUpdateTote();
    ext.set((s) => ({ ...s, capabilities: caps({ notes: true }), updateTote }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    const box = screen.getByLabelText("Notes");
    expect(box).toHaveAttribute("maxLength", "500");
    await user.type(box, "Fragile glass{Enter}Keep upright");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateTote).toHaveBeenCalledWith(1, { notes: "Fragile glass\nKeep upright" })
    );
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
    expect(screen.getByText(/Fragile glass/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit note/ })).toBeInTheDocument();
    expect(updateItems).not.toHaveBeenCalled(); // never an items write

    await user.click(screen.getByRole("button", { name: /Edit note/ }));
    await user.clear(screen.getByLabelText("Notes"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTote).toHaveBeenLastCalledWith(1, { notes: null }));
    expect(await screen.findByRole("button", { name: "Add a note" })).toBeInTheDocument();
  });

  it("notes: Cancel and an unchanged Save write nothing; a failed save shows the error and keeps the draft open", async () => {
    setup([lantern]);
    const updateTote = fakeUpdateTote();
    ext.set((s) => ({
      ...s,
      totes: [{ ...tote, items: [lantern], notes: "Fragile" }],
      capabilities: caps({ notes: true }),
      updateTote,
    }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: /Edit note/ }));
    await user.type(screen.getByLabelText("Notes"), " glass");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateTote).not.toHaveBeenCalled();
    expect(screen.getByText("Fragile")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit note/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateTote).not.toHaveBeenCalled(); // same text → nothing to save
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();

    updateTote.mockRejectedValueOnce(new Error("Couldn't save your changes. Please try again."));
    await user.click(screen.getByRole("button", { name: /Edit note/ }));
    await user.type(screen.getByLabelText("Notes"), " glass");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't save your changes. Please try again.")
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Fragile glass"); // draft kept
  });

  // ------ tags ------
  it("tags: chips under the title; 'Edit tags' opens the editor with the household's other tags; Save → updateTote(id, { tags }); Undo puts the old tags back", async () => {
    setup([lantern]);
    const updateTote = fakeUpdateTote();
    const paintTote = { id: 2, name: "Paint", position: "A1", items: [], tags: ["garage", "Winter"] };
    ext.set((s) => ({
      ...s,
      totes: [{ ...tote, items: [lantern], tags: ["winter"] }, paintTote],
      capabilities: caps({ tags: true }),
      updateTote,
    }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    expect(within(screen.getByRole("list", { name: "Tags" })).getByText("winter")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit tags" }));
    const dialog = screen.getByRole("dialog", { name: "Tags" });
    const suggested = within(dialog).getByRole("list", { name: "Suggested tags" });
    // "Winter" is already on this tote (case-insensitive) → only "garage" is offered
    expect(within(suggested).getAllByRole("button").map((b) => b.textContent)).toEqual(["garage"]);
    await user.click(within(suggested).getByRole("button", { name: "garage" }));
    await user.type(within(dialog).getByLabelText("Add a tag"), "kids{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTote).toHaveBeenCalledWith(1, { tags: ["winter", "garage", "kids"] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const chips = within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem");
    expect(chips.map((li) => li.textContent)).toEqual(["winter", "garage", "kids"]);
    expect(updateItems).not.toHaveBeenCalled();

    const [msg, opts] = toastMock.show.mock.calls.at(-1);
    expect(msg).toBe("Tags updated");
    expect(opts.actionLabel).toBe("Undo");
    await act(async () => {
      await opts.onAction();
    });
    expect(updateTote).toHaveBeenLastCalledWith(1, { tags: ["winter"] });
  });

  it("tags: with none yet the button says 'Add tag'; saving unchanged tags writes nothing; a failed save shows the service error without an Undo", async () => {
    setup([lantern]);
    const updateTote = fakeUpdateTote();
    ext.set((s) => ({ ...s, capabilities: caps({ tags: true }), updateTote }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.click(within(screen.getByRole("dialog", { name: "Tags" })).getByRole("button", { name: "Save" }));
    expect(updateTote).not.toHaveBeenCalled();
    expect(toastMock.show).not.toHaveBeenCalled();

    updateTote.mockRejectedValueOnce(
      new Error('One-time setup needed: run the SQL in MAINTENANCE.md ("One-time setup: tags, notes and swap").')
    );
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.type(screen.getByLabelText("Add a tag"), "kids");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/One-time setup needed/)));
    expect(toastMock.show).not.toHaveBeenCalled();
  });

  // ------ swap ------
  const paint = {
    id: 2,
    name: "Paint",
    position: "B4",
    items: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const frontWall = { id: "front", label: "Front wall", fixtures: [{ slots: ["B3", "B4", "B5"] }] };

  function setupMoveSheet({ swap }) {
    setup([lantern]);
    const swapTotes = vi.fn(async (aId, bId) => {
      let rows;
      ext.set((s) => {
        const a = s.totes.find((t) => t.id === aId);
        const b = s.totes.find((t) => t.id === bId);
        rows = [{ ...a, position: b.position }, { ...b, position: a.position }];
        const totes = s.totes.map((t) => rows.find((r) => r.id === t.id) || t);
        return { ...s, totes, totesByPosition: Object.fromEntries(totes.map((t) => [t.position, t])) };
      });
      return rows;
    });
    const mine = { ...tote, items: [lantern] };
    ext.set((s) => ({
      ...s,
      totes: [mine, paint],
      totesByPosition: { B3: mine, B4: paint },
      walls: [frontWall],
      capabilities: caps({ swap }),
      swapTotes,
    }));
    return { swapTotes };
  }

  it("swap: without the capability an occupied slot stays disabled, exactly as before", async () => {
    const { swapTotes } = setupMoveSheet({ swap: false });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Move" }));
    const sheet = screen.getByRole("dialog", { name: "Move “Camping Gear”" });
    expect(within(sheet).getByText(/Pick an empty spot\./)).toBeInTheDocument();
    expect(within(sheet).queryByText(/swap/i)).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /B4/ })).toBeDisabled(); // occupied
    expect(within(sheet).getByRole("button", { name: /B3/ })).toBeDisabled(); // "here"
    expect(within(sheet).getByRole("button", { name: /B5/ })).toBeEnabled(); // empty
    expect(swapTotes).not.toHaveBeenCalled();
  });

  it("swap: with the capability, tapping an occupied slot asks to confirm, swaps in one call, and Undo swaps back", async () => {
    const { swapTotes } = setupMoveSheet({ swap: true });
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByText(/tap another tote to swap places/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /B3/ })).toBeDisabled(); // still "here"
    await user.click(screen.getByRole("button", { name: "Swap with Paint in B4" }));

    const confirm = screen.getByRole("dialog", { name: "Swap with “Paint” (B4)?" });
    expect(swapTotes).not.toHaveBeenCalled(); // nothing until confirmed
    await user.click(within(confirm).getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Move “Camping Gear”" })).toBeInTheDocument();
    expect(swapTotes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Swap with Paint in B4" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(swapTotes).toHaveBeenCalledWith(1, 2));
    expect(swapTotes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateItems).not.toHaveBeenCalled(); // positions only, never items
    await waitFor(() =>
      expect(toastMock.show).toHaveBeenCalledWith(
        expect.stringMatching(/^Swapped with “Paint” — now in /),
        expect.objectContaining({ actionLabel: "Undo" })
      )
    );
    expect(ext.get().totes.find((t) => t.id === 1).position).toBe("B4");

    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      await opts.onAction();
    });
    expect(swapTotes).toHaveBeenCalledTimes(2);
    expect(swapTotes).toHaveBeenLastCalledWith(1, 2);
    expect(ext.get().totes.find((t) => t.id === 1).position).toBe("B3");
  });

  it("swap: a failed swap shows the service error and offers no Undo", async () => {
    const { swapTotes } = setupMoveSheet({ swap: true });
    swapTotes.mockRejectedValueOnce(new Error("One of those totes no longer exists."));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: "Swap with Paint in B4" }));
    await user.click(screen.getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("One of those totes no longer exists."));
    expect(toastMock.show).not.toHaveBeenCalled();
  });

  // ------ delete → Recently deleted ------
  it("delete: the toast says it's in Recently deleted for 30 days, and Undo restores by id", async () => {
    setup([lantern]);
    const deleteTote = vi.fn().mockResolvedValue(undefined);
    const restoreTote = vi.fn().mockResolvedValue(tote);
    ext.set((s) => ({ ...s, deleteTote, restoreTote }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Delete tote" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toastMock.show).toHaveBeenCalledTimes(1));
    const [msg, opts] = toastMock.show.mock.calls[0];
    expect(msg).toBe("Deleted “Camping Gear” — it's in Recently deleted for 30 days");
    expect(opts.actionLabel).toBe("Undo");
    await act(async () => {
      await opts.onAction();
    });
    expect(restoreTote).toHaveBeenCalledTimes(1);
    expect(restoreTote.mock.calls[0][0]).toMatchObject({ id: 1, name: "Camping Gear", position: "B3" });
    expect(restoreTote.mock.calls[0][0].items).toEqual([lantern]);
  });

  // ------ removed items → bin ------
  it("remove: records the item in the bin exactly once, after the removal landed, with the count you saw; Undo records nothing more", async () => {
    const { db } = setup([lantern, rope]);
    const recordRemovedItems = vi.fn().mockResolvedValue({});
    ext.set((s) => ({ ...s, recordRemovedItems }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Add one Lantern" })); // staged +1 → 3
    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));

    await waitFor(() => expect(recordRemovedItems).toHaveBeenCalledTimes(1));
    expect(recordRemovedItems).toHaveBeenCalledWith(
      { id: 1, name: "Camping Gear", position: "B3" },
      [{ ...lantern, qty: 3 }]
    );
    expect(db.items).toEqual([rope]);
    // Recorded only after the remove itself had saved
    expect(updateItems.mock.invocationCallOrder.at(-1)).toBeLessThan(
      recordRemovedItems.mock.invocationCallOrder[0]
    );

    const [, opts] = toastMock.show.mock.calls.at(-1);
    await act(async () => {
      opts.onAction();
    });
    await waitFor(() => expect(db.items).toEqual([{ ...lantern, qty: 3 }, rope]));
    await new Promise((r) => setTimeout(r, 20));
    expect(recordRemovedItems).toHaveBeenCalledTimes(1);
  });

  it("remove: nothing is recorded when the removal fails", async () => {
    setup([lantern], { failWith: new Error("Couldn't save your changes. Please try again.") });
    const recordRemovedItems = vi.fn().mockResolvedValue({});
    ext.set((s) => ({ ...s, recordRemovedItems }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't save your changes. Please try again."));
    await new Promise((r) => setTimeout(r, 20));
    expect(recordRemovedItems).not.toHaveBeenCalled();
    expect(screen.getByText("Lantern")).toBeInTheDocument(); // overlay dropped, still here
  });

  it("remove: a failure to record is silent — no extra toast, the removal stands", async () => {
    const { db } = setup([lantern, rope]);
    const recordRemovedItems = vi.fn().mockRejectedValue(new Error("bin unreachable"));
    ext.set((s) => ({ ...s, recordRemovedItems }));
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    await user.click(screen.getByRole("button", { name: "Remove Lantern" }));
    await waitFor(() => expect(recordRemovedItems).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(db.items).toEqual([rope]);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.show).toHaveBeenCalledTimes(1); // just "Removed …" with Undo
    expect(toastMock.show.mock.calls[0][0]).toBe("Removed “Lantern”");
  });

  // ------ item notes ------
  it("item note: shown in gray under the name; edited through the sheet as a note-only op; Undo and clearing work; mixed id types stay apart", async () => {
    const legacy = { id: 7, name: "Old drill", qty: 1 };
    const { db } = setup([
      { ...lantern, note: "Left glove missing" },
      legacy,
      { id: "7", name: "Impostor", qty: 1 },
    ]);
    const user = userEvent.setup();
    render(<DetailPage {...props} />);

    expect(screen.getByText("Left glove missing").closest("li")).toBe(screen.getByText("Lantern").closest("li"));

    // Edit the legacy (numeric id) item's note
    await user.click(screen.getByRole("button", { name: "Edit Old drill" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).getByLabelText(/^Note/)).toHaveValue("");
    await user.type(within(dialog).getByLabelText(/^Note/), "Needs a new battery");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(db.items[1]).toEqual({ ...legacy, note: "Needs a new battery" }));
    expect(db.items[2]).toEqual({ id: "7", name: "Impostor", qty: 1 }); // "7" untouched
    expect(screen.getByText("Needs a new battery").closest("li")).toBe(screen.getByText("Old drill").closest("li"));
    // Note-only op: a rename from the other phone survives
    const op = updateItems.mock.calls.at(-1)[1];
    expect(op([{ ...legacy, name: "Drill", qty: 4 }])).toEqual([
      { ...legacy, name: "Drill", qty: 4, note: "Needs a new battery" },
    ]);

    // Undo removes the note again (there was none before → key gone)
    const [msg, opts] = toastMock.show.mock.calls.at(-1);
    expect(msg).toBe("Updated “Old drill”");
    await act(async () => {
      opts.onAction();
    });
    await waitFor(() => expect("note" in db.items[1]).toBe(false));
    expect(screen.queryByText("Needs a new battery")).not.toBeInTheDocument();

    // Clearing the lantern's note removes the key
    await user.click(screen.getByRole("button", { name: "Edit Lantern" }));
    await user.clear(screen.getByLabelText(/^Note/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect("note" in db.items[0]).toBe(false));
    expect(screen.queryByText("Left glove missing")).not.toBeInTheDocument();
  });
});
