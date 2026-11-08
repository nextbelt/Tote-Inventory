import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// Capture what App hands to DetailPage; the page itself is covered elsewhere.
const detailProps = vi.hoisted(() => ({ last: null }));
vi.mock("../pages/DetailPage", () => ({
  default: (props) => {
    detailProps.last = props;
    return (
      <div>
        <h1>Detail: {props.tote.name}</h1>
        <button type="button" onClick={props.onBack}>
          Back
        </button>
      </div>
    );
  },
}));

const STORE_KEY = "totes-inventory";

const totes = [
  {
    id: 1,
    name: "Camping Gear",
    position: "B3",
    items: [
      { id: 12, name: "Lantern", qty: 2 }, // legacy numeric id
      { id: "6f1c-uuid", name: "Mantle", qty: 1 },
    ],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("App -> DetailPage highlightItemId", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    localStorage.setItem(STORE_KEY, JSON.stringify(totes));
    detailProps.last = null;
  });

  it("passes a numeric item id through unchanged", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(/^B3: Camping Gear/);

    await user.type(screen.getByLabelText("Search totes and items"), "lantern");
    await user.click(await screen.findByRole("button", { name: /Lantern/ }));

    await screen.findByRole("heading", { name: /Detail: Camping Gear/ });
    expect(detailProps.last.highlightItemId).toBe(12);
  });

  it("passes a string item id through unchanged", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(/^B3: Camping Gear/);

    await user.type(screen.getByLabelText("Search totes and items"), "mantle");
    await user.click(await screen.findByRole("button", { name: /Mantle/ }));

    await screen.findByRole("heading", { name: /Detail: Camping Gear/ });
    expect(detailProps.last.highlightItemId).toBe("6f1c-uuid");
  });

  it("passes no item id when a tote is opened from the garage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText(/^B3: Camping Gear/));

    await screen.findByRole("heading", { name: /Detail: Camping Gear/ });
    expect(detailProps.last.highlightItemId).toBeUndefined();
  });

  it("forgets the item id once you go back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText(/^B3: Camping Gear/);
    await user.type(screen.getByLabelText("Search totes and items"), "lantern");
    await user.click(await screen.findByRole("button", { name: /Lantern/ }));
    await screen.findByRole("heading", { name: /Detail: Camping Gear/ });

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: /Lantern/ }));
    expect(detailProps.last.highlightItemId).toBe(12);

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.clear(screen.getByLabelText("Search totes and items"));
    await user.click(await screen.findByLabelText(/^B3: Camping Gear/));
    expect(detailProps.last.highlightItemId).toBeUndefined();
  });
});
