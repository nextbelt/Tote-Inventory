import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormPage from "../FormPage";

const store = vi.hoisted(() => ({}));
const toastMock = vi.hoisted(() => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("../../hooks/useTotes", () => ({ useTotes: () => store }));
vi.mock("../../components/Toast", () => ({ useToast: () => toastMock }));
vi.mock("../../utils/images", () => ({ compressImage: async (f) => f }));
vi.mock("../../services/toteService", () => ({
  toteService: { uploadImage: async () => "https://img.test/p.jpg" },
}));

const camping = {
  id: 2,
  name: "Camping",
  position: "A1",
  items: [{ id: "u7", name: "Bungee cords", qty: 3 }],
};

beforeEach(() => {
  toastMock.show.mockReset();
  store.saveTote = vi.fn().mockResolvedValue({});
  store.updateTote = vi.fn().mockResolvedValue({});
  store.updateItems = vi.fn().mockResolvedValue({});
  store.totesByPosition = { A1: camping };
});

describe("FormPage 'Add items' hint", () => {
  it("warns that the item already exists elsewhere, without Open", async () => {
    render(<FormPage editTote={null} position="B1" onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "bungee cord" } });
    const hint = await screen.findByTestId("duplicate-hint");
    expect(hint).toHaveTextContent("You already have Bungee cords — 3 in Camping");
    // the form has no way to navigate away, so no Open button
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
  });

  it("'+1 there' bumps the other tote and leaves the new tote's list alone", async () => {
    const user = userEvent.setup();
    render(<FormPage editTote={null} position="B1" onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Bungee cords" } });
    await screen.findByTestId("duplicate-hint");
    await user.click(screen.getByRole("button", { name: /\+1 there/ }));

    const [toteId, op] = store.updateItems.mock.calls[0];
    expect(toteId).toBe(2);
    expect(op(camping.items)[0]).toMatchObject({ id: "u7", qty: 4 });
    expect(toastMock.show).toHaveBeenCalled();
    // normal add is still the default and the box is untouched
    expect(screen.getByLabelText("Item name")).toHaveValue("Bungee cords");
    expect(screen.queryByText(/^Items \(/)).toBeNull();
  });

  it("does not offer the tote being edited as 'elsewhere'", async () => {
    const editing = { ...camping, items: [{ id: "u7", name: "Bungee cords", qty: 3 }] };
    render(<FormPage editTote={editing} position="A1" onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Bungee cords" } });
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.queryByTestId("duplicate-hint")).toBeNull();
  });

  it("shows per-item hints for a list", async () => {
    render(<FormPage editTote={null} position="B1" onBack={vi.fn()} onSaved={vi.fn()} />);
    store.totesByPosition = {
      A1: camping,
      A2: { id: 3, name: "Workshop", position: "A2", items: [{ id: 1, name: "Tarp", qty: 2 }] },
    };
    fireEvent.change(screen.getByLabelText("Item name"), {
      target: { value: "bungee cords, tarps, ladder" },
    });
    const hint = await screen.findByTestId("duplicate-hint");
    expect(hint).toHaveTextContent("Bungee cords — 3 in Camping");
    expect(hint).not.toHaveTextContent("ladder");
  });
});
