import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// DetailPage is covered elsewhere: here it only exposes what App hands it.
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
        <button type="button" onClick={() => props.onEdit(props.tote)}>
          Edit
        </button>
        <button
          type="button"
          onClick={() =>
            props.onOpenTote(
              { id: 2, name: "Holiday Lights", position: "RW1", items: [] },
              { itemId: "i2" }
            )
          }
        >
          Open other
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
    items: [{ id: "i1", name: "Lantern", qty: 2 }],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Holiday Lights",
    position: "RW1",
    items: [{ id: "i2", name: "String Lights", qty: 1 }],
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
];

function openAt(url) {
  window.history.replaceState(null, "", url);
}

/** Browser back / forward: jsdom delivers popstate on a later task. */
async function traverse(direction) {
  await act(async () => {
    if (direction === "back") window.history.back();
    else window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const search = () => window.location.search;

describe("App URLs and the back gesture", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORE_KEY, JSON.stringify(totes));
    openAt("/");
    detailProps.last = null;
  });

  describe("push / pop round trips", () => {
    it("pushes a URL per screen and steps back through them with the gesture", async () => {
      const user = userEvent.setup();
      render(<App />);
      const startLength = window.history.length;

      await user.click(await screen.findByLabelText(/^B3: Camping Gear/));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(search()).toBe("?tote=1");
      expect(window.history.length).toBe(startLength + 1);

      await user.click(screen.getByRole("button", { name: "Edit" }));
      await screen.findByRole("heading", { name: "Edit Tote" });
      expect(search()).toBe("?edit=1");

      await traverse("back");
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(search()).toBe("?tote=1");

      await traverse("back");
      expect(
        await screen.findByRole("heading", { name: "Garage Totes" })
      ).toBeInTheDocument();
      expect(search()).toBe("");

      // And forward again, without pushing anything new
      const lengthBefore = window.history.length;
      await traverse("forward");
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(window.history.length).toBe(lengthBefore);
    });

    it("opens the new-tote form at ?new=<position>", async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(
        await screen.findByRole("button", { name: "A1: empty slot, add a tote" })
      );
      await screen.findByRole("heading", { name: "New Tote" });
      expect(search()).toBe("?new=A1");

      await traverse("back");
      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(search()).toBe("");
    });

    it("the in-app Back button steps back one entry instead of pushing", async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(await screen.findByLabelText(/^B3: Camping Gear/));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      const lengthOnTote = window.history.length;
      await user.click(screen.getByRole("button", { name: "Back" }));

      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(search()).toBe("");
      // The tote entry is still there to go forward to; nothing was added
      expect(window.history.length).toBe(lengthOnTote);
      await traverse("forward");
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
    });

    it("mirrors search text, mode and wall into the garage URL", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);

      await user.click(screen.getByRole("button", { name: "All totes" }));
      await waitFor(() => expect(search()).toBe("?mode=list"));

      await user.type(screen.getByLabelText("Search totes and items"), "lantern");
      await waitFor(() => expect(search()).toBe("?q=lantern&mode=list"));
    });
  });

  describe("Back via popstate restores the garage", () => {
    it("restores search text, mode and scroll position", async () => {
      const user = userEvent.setup();
      const scrollTo = vi.fn();
      const originalScrollTo = window.scrollTo;
      window.scrollTo = scrollTo;
      try {
        render(<App />);
        await screen.findByLabelText(/^B3: Camping Gear/);
        await user.type(screen.getByLabelText("Search totes and items"), "lantern");

        window.scrollY = 420;
        await user.click(await screen.findByRole("button", { name: /Lantern/ }));
        await screen.findByRole("heading", { name: "Detail: Camping Gear" });
        window.scrollY = 0;
        scrollTo.mockClear();

        await traverse("back");
        expect(await screen.findByLabelText("Search totes and items")).toHaveValue(
          "lantern"
        );
        expect(
          screen.getByRole("list", { name: "Search results" })
        ).toBeInTheDocument();
        expect(scrollTo).toHaveBeenLastCalledWith(0, 420);
        expect(search()).toBe("?q=lantern");
      } finally {
        window.scrollTo = originalScrollTo;
        window.scrollY = 0;
      }
    });

    it("restores the All totes mode", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.click(screen.getByRole("button", { name: "All totes" }));
      const list = await screen.findByRole("list", { name: "All totes" });
      await user.click(list.querySelector("button"));
      await screen.findByRole("heading", { name: /^Detail:/ });

      await traverse("back");
      expect(await screen.findByRole("list", { name: "All totes" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All totes" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("forgets the highlighted item after going back", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      await user.type(screen.getByLabelText("Search totes and items"), "lantern");
      await user.click(await screen.findByRole("button", { name: /Lantern/ }));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(detailProps.last.highlightItemId).toBe("i1");

      await traverse("back");
      await screen.findByRole("list", { name: "Search results" });
      await user.click(await screen.findByRole("button", { name: /Lantern/ }));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      await traverse("back");
      await screen.findByRole("list", { name: "Search results" });
      await user.clear(screen.getByLabelText("Search totes and items"));
      await user.click(await screen.findByLabelText(/^B3: Camping Gear/));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(detailProps.last.highlightItemId).toBeUndefined();
    });
  });

  describe("deep links", () => {
    it("opens ?tote=<id> once data has loaded, without a dead history entry", async () => {
      openAt("/?tote=2");
      const startLength = window.history.length;
      render(<App />);

      await screen.findByRole("heading", { name: "Detail: Holiday Lights" });
      expect(search()).toBe("?tote=2");
      expect(window.history.length).toBe(startLength);
    });

    it("Back from a deep link goes to the garage (nothing of ours behind it)", async () => {
      openAt("/?tote=2");
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Detail: Holiday Lights" });

      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(
        await screen.findByRole("heading", { name: "Garage Totes" })
      ).toBeInTheDocument();
      expect(search()).toBe("");
    });

    it("tells the user when ?tote=<id> is gone and shows the garage", async () => {
      openAt("/?tote=999");
      render(<App />);

      expect(await screen.findByText("That tote isn't here anymore")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Garage Totes" })).toBeInTheDocument();
      expect(search()).toBe("");
    });

    it("?slot= on an occupied slot opens that tote", async () => {
      openAt("/?slot=B3");
      render(<App />);

      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(search()).toBe("?tote=1");
    });

    it("?slot= on an empty slot opens the new-tote form for it", async () => {
      openAt("/?slot=A1");
      render(<App />);

      await screen.findByRole("heading", { name: "New Tote" });
      expect(search()).toBe("?new=A1");
      expect(screen.getByText(/^A1 —/)).toBeInTheDocument();
    });

    it("?slot= for a spot that does not exist shows the garage with a message", async () => {
      openAt("/?slot=ZZ99");
      render(<App />);

      expect(await screen.findByText("That spot isn't in your garage")).toBeInTheDocument();
      expect(search()).toBe("");
    });

    it("rejects reserved positions as slots and as tote ids", async () => {
      openAt("/?slot=__config__");
      const { unmount } = render(<App />);
      expect(
        await screen.findByRole("heading", { name: "Garage Totes" })
      ).toBeInTheDocument();
      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(screen.queryByText(/isn't here|isn't in your garage/)).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "New Tote" })).not.toBeInTheDocument();
      unmount();

      openAt("/?new=__removed_items__");
      render(<App />);
      await screen.findByLabelText(/^B3: Camping Gear/);
      expect(screen.queryByRole("heading", { name: "New Tote" })).not.toBeInTheDocument();
    });

    it("opens ?edit=<id> in the edit form", async () => {
      openAt("/?edit=1");
      render(<App />);

      await screen.findByRole("heading", { name: "Edit Tote" });
      expect(screen.getByLabelText("Tote name")).toHaveValue("Camping Gear");
    });

    it("starts the garage from ?q, ?mode and ?wall", async () => {
      openAt("/?q=lantern&mode=list&wall=right");
      render(<App />);

      expect(await screen.findByLabelText("Search totes and items")).toHaveValue(
        "lantern"
      );
      expect(screen.getByRole("list", { name: "Search results" })).toBeInTheDocument();
    });
  });

  describe("onOpenTote", () => {
    it("navigates to the other tote, highlights the item and is one Back away", async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByLabelText(/^B3: Camping Gear/));
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(detailProps.last.highlightItemId).toBeUndefined();

      await user.click(screen.getByRole("button", { name: "Open other" }));
      await screen.findByRole("heading", { name: "Detail: Holiday Lights" });
      expect(detailProps.last.highlightItemId).toBe("i2");
      expect(search()).toBe("?tote=2");

      await traverse("back");
      await screen.findByRole("heading", { name: "Detail: Camping Gear" });
      expect(search()).toBe("?tote=1");
    });
  });
});
