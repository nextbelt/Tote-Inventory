import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWalls } from "../../utils/constants";
import BackupSheet from "../BackupSheet";

const state = vi.hoisted(() => ({ ctx: null, download: null }));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => state.ctx }));
vi.mock("../../utils/backup", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, downloadFile: (...args) => state.download(...args) };
});

const walls = buildWalls();
const tote = (id, position, name, items = []) => ({ id, name, position, items });

function setup({ totes, capabilities } = {}) {
  const list = totes ?? [tote(1, "A1", "Paint", [{ id: 10, name: "Brush", qty: 2 }])];
  const saveTote = vi.fn(async (t) => ({ ...t, id: 1000 + saveTote.mock.calls.length }));
  const updateItems = vi.fn(async (id) => ({ id }));
  state.download = vi.fn().mockResolvedValue("downloaded");
  state.ctx = {
    totes: list,
    layout: { leftShelves: 5 },
    walls,
    capabilities: capabilities ?? { tags: true, notes: true, swap: true },
    saveTote,
    updateItems,
  };
  render(<BackupSheet onClose={vi.fn()} />);
  return { saveTote, updateItems };
}

const backupFile = (totes, name = "garage-totes-backup-2026-11-01.json") =>
  new File(
    [
      JSON.stringify({
        app: "garage-totes",
        version: 1,
        exportedAt: "2026-11-01T00:00:00.000Z",
        layout: null,
        totes,
      }),
    ],
    name,
    { type: "application/json" }
  );

async function choose(user, file) {
  await user.upload(screen.getByLabelText("Backup file"), file);
}

describe("BackupSheet downloads", () => {
  beforeEach(() => {
    state.ctx = null;
  });

  it("saves the JSON backup through downloadFile", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Save backup \(JSON\)/ }));
    expect(state.download).toHaveBeenCalledTimes(1);
    const [filename, mime, text] = state.download.mock.calls[0];
    expect(filename).toMatch(/^garage-totes-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe("application/json");
    const data = JSON.parse(text);
    expect(data.app).toBe("garage-totes");
    expect(data.layout).toEqual({ leftShelves: 5 });
    expect(data.totes.map((t) => t.name)).toEqual(["Paint"]);
    expect(await screen.findByRole("status")).toHaveTextContent(/downloaded/i);
  });

  it("never puts reserved rows in the backup file", async () => {
    const user = userEvent.setup();
    setup({
      totes: [tote(1, "A1", "Paint"), tote(2, "__config__", "cfg"), tote(3, "__deleted__:B1:3", "old")],
    });
    await user.click(screen.getByRole("button", { name: /Save backup/ }));
    const data = JSON.parse(state.download.mock.calls[0][2]);
    expect(data.totes.map((t) => t.id)).toEqual([1]);
  });

  it("exports the CSV with spoken-style locations and the Tags and Note columns", async () => {
    const user = userEvent.setup();
    setup({
      totes: [
        { ...tote(1, "A1", "Paint", [{ id: 10, name: "Brush", qty: 2, note: "soft" }]), tags: ["art"] },
      ],
    });
    await user.click(screen.getByRole("button", { name: /Export list \(CSV\)/ }));
    const [filename, mime, text] = state.download.mock.calls[0];
    expect(filename).toMatch(/^garage-totes-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mime).toBe("text/csv");
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Tote,Location,Item,Quantity,Photo,Tags,Note");
    expect(lines[1]).toBe(
      "Paint,Front wall · Left rack · top shelf · left bin,Brush,2,,art,soft"
    );
  });

  it("reports a cancelled share without claiming it saved", async () => {
    const user = userEvent.setup();
    setup();
    state.download.mockResolvedValue("cancelled");
    await user.click(screen.getByRole("button", { name: /Save backup/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Cancelled/);
  });

  it("shows an error when saving fails", async () => {
    const user = userEvent.setup();
    setup();
    state.download.mockRejectedValue(new Error("nope"));
    await user.click(screen.getByRole("button", { name: /Save backup/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't save the backup/);
  });
});

describe("BackupSheet restore", () => {
  beforeEach(() => {
    state.ctx = null;
  });

  it("explains a file that is not a backup and changes nothing", async () => {
    const user = userEvent.setup();
    const { saveTote, updateItems } = setup();
    await choose(user, new File(["hello"], "x.json", { type: "application/json" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid JSON|not a backup/);
    expect(saveTote).not.toHaveBeenCalled();
    expect(updateItems).not.toHaveBeenCalled();
  });

  it("previews what will be added and what is skipped", async () => {
    const user = userEvent.setup();
    setup({
      totes: [
        tote(1, "A1", "Paint", [{ id: 10, name: "Brush" }]),
        tote(5, "C1", "Squatter"),
      ],
    });
    await choose(
      user,
      backupFile([
        // exists, missing one item -> 1 item added
        tote(1, "A1", "Paint", [
          { id: 10, name: "Brush" },
          { id: 11, name: "Roller" },
        ]),
        // gone, spot free -> 1 tote + 2 items
        tote(2, "B1", "Tools", [
          { id: 20, name: "Saw" },
          { id: "u-1", name: "Drill" },
        ]),
        // gone, spot taken -> skipped
        tote(3, "C1", "Camping", [{ id: 30, name: "Tent" }]),
      ])
    );
    const preview = await screen.findByLabelText("Restore preview");
    expect(preview).toHaveTextContent(
      "Will add 1 tote and 3 items; 1 tote's spot is taken — skipped"
    );
    expect(preview).toHaveTextContent("“Camping” (C1) — taken by “Squatter”");
  });

  it("applies the plan: creates free-spot totes, adds missing items, skips conflicts, reports", async () => {
    const user = userEvent.setup();
    const { saveTote, updateItems } = setup({
      totes: [tote(1, "A1", "Paint", [{ id: 10, name: "Brush" }]), tote(5, "C1", "Squatter")],
    });
    await choose(
      user,
      backupFile([
        tote(1, "A1", "RENAMED IN BACKUP", [
          { id: 10, name: "Brush CHANGED", qty: 9 },
          { id: 11, name: "Roller", note: "wide" },
        ]),
        { ...tote(2, "B1", "Tools", [{ id: 20, name: "Saw" }]), tags: ["garage"], notes: "top lid" },
        tote(3, "C1", "Camping", [{ id: 30, name: "Tent" }]),
      ])
    );
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(screen.getByText(/Added 1 tote and 2 items/)).toBeInTheDocument());

    // The missing tote is created in ITS free spot, with tags and notes
    expect(saveTote).toHaveBeenCalledTimes(1);
    expect(saveTote).toHaveBeenCalledWith(
      {
        name: "Tools",
        position: "B1",
        items: [{ id: 20, name: "Saw" }],
        tags: ["garage"],
        notes: "top lid",
      },
      true
    );

    // The existing tote only gets the missing item, as an add op
    expect(updateItems).toHaveBeenCalledTimes(1);
    const [toteId, op] = updateItems.mock.calls[0];
    expect(toteId).toBe(1);
    const live = [{ id: 10, name: "Brush", qty: 1 }];
    expect(op(live)).toEqual([
      { id: 10, name: "Brush", qty: 1 }, // never overwritten
      { id: 11, name: "Roller", note: "wide" },
    ]);
    expect(op(op(live))).toEqual(op(live)); // idempotent

    // The taken spot is skipped and reported
    expect(screen.getByText(/Skipped because the spot is taken: “Camping”/)).toBeInTheDocument();
    // The Squatter was left alone: nothing but the calls above happened
  });

  it("leaves tags and notes out when the database does not have those columns", async () => {
    const user = userEvent.setup();
    const { saveTote } = setup({
      totes: [],
      capabilities: { tags: false, notes: false, swap: false },
    });
    await choose(
      user,
      backupFile([{ ...tote(2, "B1", "Tools"), tags: ["garage"], notes: "top lid" }])
    );
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(saveTote).toHaveBeenCalled());
    expect(saveTote.mock.calls[0][0]).toEqual({ name: "Tools", position: "B1", items: [] });
  });

  it("keeps going when one tote fails and says which one", async () => {
    const user = userEvent.setup();
    const { saveTote } = setup({ totes: [] });
    saveTote.mockImplementationOnce(async () => {
      throw new Error("That spot is not available");
    });
    await choose(user, backupFile([tote(2, "B1", "Tools"), tote(3, "B2", "Garden")]));
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    const report = await screen.findByText(/Added 1 tote and 0 items/);
    expect(saveTote).toHaveBeenCalledTimes(2);
    expect(within(report.closest("[role=status]")).getByText(/“Tools”: That spot is not available/)).toBeInTheDocument();
  });

  it("offers nothing to restore when everything is already here", async () => {
    const user = userEvent.setup();
    const { saveTote } = setup({ totes: [tote(1, "A1", "Paint", [{ id: 10, name: "Brush" }])] });
    await choose(user, backupFile([tote(1, "A1", "Paint", [{ id: 10, name: "Brush" }])]));
    const preview = await screen.findByLabelText("Restore preview");
    expect(preview).toHaveTextContent(/Nothing to restore/);
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(saveTote).not.toHaveBeenCalled();
  });

  it("does not duplicate an item that was moved to another tote", async () => {
    const user = userEvent.setup();
    setup({
      totes: [tote(1, "A1", "Paint"), tote(2, "B1", "Tools", [{ id: 10, name: "Brush" }])],
    });
    await choose(user, backupFile([tote(1, "A1", "Paint", [{ id: 10, name: "Brush" }])]));
    const preview = await screen.findByLabelText("Restore preview");
    expect(preview).toHaveTextContent("1 item already lives in another tote — left alone");
  });

  it("cancel clears the preview without touching anything", async () => {
    const user = userEvent.setup();
    const { saveTote, updateItems } = setup({ totes: [] });
    await choose(user, backupFile([tote(2, "B1", "Tools")]));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Restore preview")).not.toBeInTheDocument();
    expect(saveTote).not.toHaveBeenCalled();
    expect(updateItems).not.toHaveBeenCalled();
  });
});
