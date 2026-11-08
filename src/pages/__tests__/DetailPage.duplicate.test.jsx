import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DetailPage from "../DetailPage";

const store = vi.hoisted(() => ({}));
const toastMock = vi.hoisted(() => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => store }));
vi.mock("../../components/Toast", () => ({ useToast: () => toastMock }));
vi.mock("../../utils/images", () => ({ compressImage: async (f) => f }));
vi.mock("../../services/toteService", () => ({
  toteService: { uploadImage: async () => "https://img.test/p.jpg" },
}));

const here = { id: 1, name: "Garage Odds", position: "B3", items: [{ id: "h1", name: "Rope", qty: 1 }] };
const camping = {
  id: 2,
  name: "Camping",
  position: "A1",
  items: [
    { id: 7, name: "Bungee cords", qty: 3 }, // legacy numeric id
    { id: "u1", name: "Lantern", qty: 1 },
  ],
};
const workshop = {
  id: "w",
  name: "Workshop",
  position: "A2",
  items: [{ id: "u2", name: "bungee cord", qty: 1 }, { id: "u3", name: "Tarp", qty: 0 }],
};

function setup({ onOpenTote } = {}) {
  store.totes = [here, camping, workshop];
  store.totesByPosition = { B3: here, A1: camping, A2: workshop };
  store.walls = [];
  store.updateItems = vi.fn(async () => ({}));
  store.deleteTote = vi.fn();
  store.moveTote = vi.fn();
  store.restoreTote = vi.fn();
  render(
    <DetailPage
      tote={here}
      onBack={vi.fn()}
      onEdit={vi.fn()}
      onDeleted={vi.fn()}
      onShowInGarage={vi.fn()}
      onOpenTote={onOpenTote}
    />
  );
}

describe("DetailPage quick-add 'You already have one' hint", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.error.mockReset();
  });

  it("shows where the household already has the item, with up to two matches", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Add items"), { target: { value: "bungee cord" } });
    const hint = await screen.findByTestId("duplicate-hint");
    expect(hint).toHaveTextContent("You already have Bungee cords — 3 in Camping");
    expect(hint).toHaveTextContent("Also bungee cord — 1 in Workshop");
  });

  it("stays out of the way: nothing for a new item, the current tote, or an empty box", async () => {
    setup();
    const box = screen.getByLabelText("Add items");
    fireEvent.change(box, { target: { value: "Rope" } }); // only in THIS tote
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.queryByTestId("duplicate-hint")).toBeNull();
    fireEvent.change(box, { target: { value: "Lantern" } });
    expect(await screen.findByTestId("duplicate-hint")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.queryByTestId("duplicate-hint")).toBeNull();
  });

  it("'+1 there' bumps the quantity in the other tote with an adjustQty op and toasts", async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.change(screen.getByLabelText("Add items"), { target: { value: "Bungee cords" } });
    await screen.findByTestId("duplicate-hint");
    await user.click(screen.getAllByRole("button", { name: /\+1 there/ })[0]);

    expect(store.updateItems).toHaveBeenCalledTimes(1);
    const [toteId, op] = store.updateItems.mock.calls[0];
    expect(toteId).toBe(2);
    // the op bumps the item with the ORIGINAL numeric id, leaves others alone
    const next = op(camping.items);
    expect(next[0]).toMatchObject({ id: 7, qty: 4 });
    expect(next[1]).toEqual(camping.items[1]);
    expect(toastMock.show).toHaveBeenCalledWith(
      expect.stringContaining("Bungee cords"),
      expect.objectContaining({ actionLabel: "Undo" })
    );
    // nothing was added to the current tote
    expect(store.updateItems).not.toHaveBeenCalledWith(1, expect.anything());
  });

  it("reports a failed '+1 there'", async () => {
    const user = userEvent.setup();
    setup();
    store.updateItems.mockRejectedValue(new Error("offline"));
    fireEvent.change(screen.getByLabelText("Add items"), { target: { value: "Bungee cords" } });
    await screen.findByTestId("duplicate-hint");
    await user.click(screen.getAllByRole("button", { name: /\+1 there/ })[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("offline"));
  });

  it("hides Open without onOpenTote and calls it with the item when present", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Add items"), { target: { value: "Bungee cords" } });
    await screen.findByTestId("duplicate-hint");
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
  });

  it("Open goes to the other tote and highlights the item", async () => {
    const user = userEvent.setup();
    const onOpenTote = vi.fn();
    setup({ onOpenTote });
    fireEvent.change(screen.getByLabelText("Add items"), { target: { value: "Bungee cords" } });
    await screen.findByTestId("duplicate-hint");
    await user.click(screen.getAllByRole("button", { name: /^Open/ })[0]);
    expect(onOpenTote).toHaveBeenCalledWith(camping, { itemId: 7 });
  });

  it("gives compact per-item hints for a list, and Add still works as normal", async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.change(screen.getByLabelText("Add items"), {
      target: { value: "2 bungee cords, lantern, brand new thing" },
    });
    const hint = await screen.findByTestId("duplicate-hint");
    expect(hint).toHaveTextContent("Bungee cords — 3 in Camping");
    expect(hint).toHaveTextContent("Lantern — 1 in Camping");
    expect(hint).not.toHaveTextContent("brand new thing");

    await user.click(screen.getByRole("button", { name: "Add 3 items" }));
    expect(store.updateItems).toHaveBeenCalledTimes(1);
    expect(store.updateItems.mock.calls[0][0]).toBe(1);
  });

  it("does not hint on text typed into the box but already gone after Add", async () => {
    const user = userEvent.setup();
    setup();
    const box = screen.getByLabelText("Add items");
    await user.type(box, "Lantern");
    await screen.findByTestId("duplicate-hint");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(screen.queryByTestId("duplicate-hint")).toBeNull());
  });
});
