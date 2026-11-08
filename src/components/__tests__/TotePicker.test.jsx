import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TotePicker from "../TotePicker";

const totes = [
  { id: 1, name: "Camping Gear", position: "B3", items: [{ id: "a" }], updated_at: "2026-03-01T00:00:00Z" },
  { id: 2, name: "Paint", position: "C4", items: [], updated_at: "2026-01-01T00:00:00Z" },
  { id: 3, name: "Holiday Lights", position: "LW2", items: [{ id: "b" }, { id: "c" }], updated_at: "2026-06-01T00:00:00Z" },
  { id: 4, name: "Tools", position: "RW1B", items: [{ id: "d" }], created_at: "2026-02-01T00:00:00Z" },
  { id: 99, name: "settings", position: "__config__", items: {} },
];

function setup(props = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <TotePicker
      title="Move “Lantern” to…"
      totes={totes}
      excludeId={1}
      onPick={onPick}
      onClose={onClose}
      {...props}
    />
  );
  return { onPick, onClose };
}

describe("TotePicker", () => {
  it("lists the OTHER totes, most recently modified first, with path and item count", () => {
    setup();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".font-semibold").textContent)).toEqual([
      "Holiday Lights",
      "Tools",
      "Paint",
    ]);
    expect(screen.queryByText("Camping Gear")).not.toBeInTheDocument(); // this tote
    expect(screen.queryByText("settings")).not.toBeInTheDocument(); // hidden config row
    expect(within(rows[0]).getByText("Left wall · Shelf 2")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 items")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Right wall · Shelf 1 · Slot B")).toBeInTheDocument();
    expect(within(rows[1]).getByText("1 item")).toBeInTheDocument();
    expect(within(rows[2]).getByText("0 items")).toBeInTheDocument();
  });

  it("picking a tote hands back the tote object itself", async () => {
    const { onPick } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Paint/ }));
    expect(onPick).toHaveBeenCalledWith(totes[1]);
  });

  it("filters by name or location, and says so when nothing matches", async () => {
    setup();
    const user = userEvent.setup();
    const filter = screen.getByLabelText("Filter totes");

    await user.type(filter, "light");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Holiday Lights")).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "right wall");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Tools")).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "zzz");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("No totes match “zzz”.")).toBeInTheDocument();
  });

  it("explains when there is no other tote to move to", () => {
    setup({ totes: [totes[0]] });
    expect(screen.getByText("There are no other totes yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter totes")).not.toBeInTheDocument();
  });

  it("closes from the header button", async () => {
    const { onClose } = setup();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Close" })[1]);
    expect(onClose).toHaveBeenCalled();
  });
});
