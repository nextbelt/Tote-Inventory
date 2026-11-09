import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWalls } from "../../utils/constants";
import RecentlyDeletedSheet from "../RecentlyDeletedSheet";

const state = vi.hoisted(() => ({ ctx: null, toast: null }));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => state.ctx }));
vi.mock("../Toast", () => ({ useToast: () => state.toast }));

const walls = buildWalls();
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const tote = (id, position, name, items = []) => ({ id, name, position, items });
const gone = (id, name, originalPosition, items = []) => ({
  id,
  name,
  originalPosition,
  deletedAt: daysAgo(2),
  items,
});
const binEntry = (toteId, toteName, item, position = "A1") => ({
  id: `${toteId}:${item.id}:${daysAgo(3)}`,
  item,
  toteId,
  toteName,
  position,
  removedAt: daysAgo(3),
});

function codeError(message, code) {
  return Object.assign(new Error(message), { code });
}

function setup({ totes = [], deleted = [], removed = [], overrides = {} } = {}) {
  state.toast = { show: vi.fn(), error: vi.fn(), dismiss: vi.fn() };
  state.ctx = {
    totes,
    totesByPosition: Object.fromEntries(totes.map((t) => [t.position, t])),
    walls,
    deleted,
    restoreDeletedTote: vi.fn(async (id, pos) => ({ id, position: pos ?? "B1" })),
    purgeDeletedTote: vi.fn(async () => {}),
    listRemovedItems: vi.fn().mockResolvedValue(removed),
    restoreRemovedItem: vi.fn(async (entryId, targetId) => ({
      id: targetId ?? 1,
      name: "Paint",
    })),
    ...overrides,
  };
  render(<RecentlyDeletedSheet onClose={vi.fn()} />);
  return state.ctx;
}

describe("RecentlyDeletedSheet: deleted totes", () => {
  beforeEach(() => {
    state.ctx = null;
  });

  it("shows name, original spot in words and how long ago", () => {
    setup({ deleted: [gone(7, "Camping", "A1", [{ id: 1, name: "Tent" }])] });
    expect(screen.getByText("Camping")).toBeInTheDocument();
    expect(
      screen.getByText(/Front wall · Left rack · top shelf · left bin · 1 item/)
    ).toBeInTheDocument();
    expect(screen.getByText("Deleted 2 days ago")).toBeInTheDocument();
  });

  it("restores to the original spot when it is free", async () => {
    const user = userEvent.setup();
    const ctx = setup({ deleted: [gone(7, "Camping", "A1")] });
    await user.click(screen.getByRole("button", { name: "Restore Camping" }));
    expect(ctx.restoreDeletedTote).toHaveBeenCalledWith(7, undefined);
    await waitFor(() => expect(state.toast.show).toHaveBeenCalled());
    expect(state.toast.show.mock.calls[0][0]).toMatch(/Put “Camping” back/);
  });

  it("offers free spots when the original spot is taken, then restores there", async () => {
    const user = userEvent.setup();
    const ctx = setup({
      totes: [tote(1, "A1", "Paint")],
      deleted: [gone(7, "Camping", "A1")],
    });
    await user.click(screen.getByRole("button", { name: "Restore Camping" }));
    expect(ctx.restoreDeletedTote).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: /Where should “Camping” go\?/ });
    // The taken spot is not offered; free ones are, grouped by wall
    expect(within(dialog).queryByRole("button", { name: /^A1\b/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^A2\b/ }));
    expect(ctx.restoreDeletedTote).toHaveBeenCalledWith(7, "A2");
  });

  it("falls back to the picker when the spot was taken meanwhile", async () => {
    const user = userEvent.setup();
    const ctx = setup({
      deleted: [gone(7, "Camping", "A1")],
      overrides: {
        restoreDeletedTote: vi
          .fn()
          .mockRejectedValueOnce(codeError("That spot is taken", "SLOT_TAKEN"))
          .mockResolvedValue({ id: 7, position: "A2" }),
      },
    });
    await user.click(screen.getByRole("button", { name: "Restore Camping" }));
    const dialog = await screen.findByRole("dialog", { name: /Where should “Camping” go\?/ });
    await user.click(within(dialog).getByRole("button", { name: /^A2\b/ }));
    expect(ctx.restoreDeletedTote).toHaveBeenLastCalledWith(7, "A2");
  });

  it("asks before deleting forever, and Keep it purges nothing", async () => {
    const user = userEvent.setup();
    const ctx = setup({ deleted: [gone(7, "Camping", "A1")] });
    await user.click(screen.getByRole("button", { name: "Delete Camping forever" }));
    expect(ctx.purgeDeletedTote).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("This can't be undone");

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(ctx.purgeDeletedTote).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Camping forever" }));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Delete forever" }));
    expect(ctx.purgeDeletedTote).toHaveBeenCalledTimes(1);
    expect(ctx.purgeDeletedTote).toHaveBeenCalledWith(7);
  });

  it("shows an empty state", async () => {
    setup();
    expect(await screen.findByText(/Nothing here/)).toBeInTheDocument();
  });
});

describe("RecentlyDeletedSheet: removed items", () => {
  beforeEach(() => {
    state.ctx = null;
  });

  it("lists removed items with their tote and when, and puts one back", async () => {
    const user = userEvent.setup();
    const entry = binEntry(1, "Paint", { id: 10, name: "Roller" });
    const ctx = setup({ totes: [tote(1, "A1", "Paint")], removed: [entry] });
    expect(await screen.findByText("Roller")).toBeInTheDocument();
    expect(screen.getByText(/From “Paint” \(A1\)/)).toBeInTheDocument();
    expect(screen.getByText("Removed 3 days ago")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Put back Roller" }));
    expect(ctx.restoreRemovedItem).toHaveBeenCalledWith(entry.id, undefined);
    await waitFor(() => expect(screen.queryByText("Roller")).not.toBeInTheDocument());
    expect(state.toast.show.mock.calls[0][0]).toMatch(/Put “Roller” back/);
  });

  it("hides entries whose item is already back in its original tote", async () => {
    const back = binEntry(1, "Paint", { id: 10, name: "Roller" });
    const missing = binEntry(1, "Paint", { id: 11, name: "Brush" });
    setup({
      totes: [tote(1, "A1", "Paint", [{ id: 10, name: "Roller" }])],
      removed: [back, missing],
    });
    expect(await screen.findByText("Brush")).toBeInTheDocument();
    expect(screen.queryByText("Roller")).not.toBeInTheDocument();
  });

  it("hides entries whose item now lives in ANY tote (moved on after an Undo) — including when the original tote is gone", async () => {
    const movedOn = binEntry(1, "Paint", { id: 10, name: "Roller" }); // now in Tools
    const homeless = binEntry(99, "Old tote", { id: 11, name: "Brush" }); // tote gone, item nowhere
    const adopted = binEntry(99, "Old tote", { id: 12, name: "Tray" }); // tote gone, item in Tools
    setup({
      totes: [
        tote(1, "A1", "Paint"),
        tote(2, "B1", "Tools", [{ id: 10, name: "Roller" }, { id: 12, name: "Tray" }]),
      ],
      removed: [movedOn, homeless, adopted],
    });
    expect(await screen.findByText("Brush")).toBeInTheDocument();
    expect(screen.queryByText("Roller")).not.toBeInTheDocument();
    expect(screen.queryByText("Tray")).not.toBeInTheDocument();
  });

  it("ALREADY_THERE on Put back (the item got a home before this phone caught up): the entry goes, a plain toast says where it is", async () => {
    const user = userEvent.setup();
    setup({
      totes: [tote(1, "A1", "Paint")],
      removed: [binEntry(1, "Paint", { id: 10, name: "Roller" })],
      overrides: {
        restoreRemovedItem: vi
          .fn()
          .mockRejectedValue(codeError("“Roller” is already in “Tools”.", "ALREADY_THERE")),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Put back Roller" }));
    await waitFor(() => expect(screen.queryByText("Roller")).not.toBeInTheDocument());
    expect(state.toast.show).toHaveBeenCalledWith("“Roller” is already in “Tools”.");
    expect(state.toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /which tote/ })).not.toBeInTheDocument();
  });

  it("compares ids by type: a string id does not hide a numeric one", async () => {
    setup({
      totes: [tote(1, "A1", "Paint", [{ id: "10", name: "Other" }])],
      removed: [binEntry(1, "Paint", { id: 10, name: "Roller" })],
    });
    expect(await screen.findByText("Roller")).toBeInTheDocument();
  });

  it("lets the user pick a tote when the original one is gone", async () => {
    const user = userEvent.setup();
    const entry = binEntry(99, "Old tote", { id: 10, name: "Roller" });
    const ctx = setup({
      totes: [tote(1, "A1", "Paint"), tote(2, "B1", "Tools")],
      removed: [entry],
      overrides: {
        restoreRemovedItem: vi
          .fn()
          .mockRejectedValueOnce(codeError("The tote is gone", "TOTE_GONE"))
          .mockResolvedValue({ id: 2, name: "Tools" }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Put back Roller" }));
    const picker = await screen.findByRole("dialog", { name: /Put “Roller” in which tote\?/ });
    await user.click(within(picker).getByRole("button", { name: /Tools/ }));
    expect(ctx.restoreRemovedItem).toHaveBeenLastCalledWith(entry.id, 2);
    await waitFor(() =>
      expect(state.toast.show.mock.calls[0][0]).toMatch(/Put “Roller” back in “Tools”/)
    );
  });

  it("drops an entry the other phone already put back", async () => {
    const user = userEvent.setup();
    setup({
      totes: [tote(1, "A1", "Paint")],
      removed: [binEntry(1, "Paint", { id: 10, name: "Roller" })],
      overrides: {
        restoreRemovedItem: vi
          .fn()
          .mockRejectedValue(codeError("That item is no longer in the bin.", "NO_TOMBSTONE")),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Put back Roller" }));
    await waitFor(() => expect(screen.queryByText("Roller")).not.toBeInTheDocument());
    expect(state.toast.error).toHaveBeenCalledWith("That item is no longer in the bin.");
  });

  it("ignores a second tap while the first is saving", async () => {
    const user = userEvent.setup();
    let release;
    const ctx = setup({
      totes: [tote(1, "A1", "Paint")],
      removed: [binEntry(1, "Paint", { id: 10, name: "Roller" })],
      overrides: {
        restoreRemovedItem: vi.fn(
          () => new Promise((resolve) => (release = () => resolve({ id: 1, name: "Paint" })))
        ),
      },
    });
    const button = await screen.findByRole("button", { name: "Put back Roller" });
    await user.click(button);
    await user.click(button);
    expect(ctx.restoreRemovedItem).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByText("Roller")).not.toBeInTheDocument());
  });

  it("says so when the bin cannot be read, and still shows deleted totes", async () => {
    setup({
      deleted: [gone(7, "Camping", "A1")],
      overrides: { listRemovedItems: vi.fn().mockRejectedValue(new Error("offline")) },
    });
    expect(await screen.findByText(/Couldn.t load removed items/)).toBeInTheDocument();
    expect(screen.getByText("Camping")).toBeInTheDocument();
  });
});
