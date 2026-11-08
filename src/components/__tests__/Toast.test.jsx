import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../Toast";

function Probe({ onReady }) {
  onReady(useToast());
  return null;
}

function renderToasts() {
  let api;
  render(
    <ToastProvider>
      <Probe onReady={(t) => (api = t)} />
    </ToastProvider>
  );
  return () => api;
}

describe("ToastProvider queue", () => {
  it("never drops a toast with a live Undo to make room — only plain toasts", () => {
    const toast = renderToasts();
    act(() => {
      toast().show("Removed “Lantern”", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("plain 1");
      toast().show("plain 2");
      toast().show("plain 3");
    });

    expect(screen.getByText("Removed “Lantern”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // Capped at 3 visible: the OLDEST plain toast went, not the Undo
    expect(screen.queryByText("plain 1")).not.toBeInTheDocument();
    expect(screen.getByText("plain 2")).toBeInTheDocument();
    expect(screen.getByText("plain 3")).toBeInTheDocument();
  });

  it("keeps every Undo when several items are removed quickly", () => {
    const toast = renderToasts();
    const actions = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    act(() => {
      actions.forEach((onAction, i) =>
        toast().show(`Removed item ${i + 1}`, { actionLabel: "Undo", onAction })
      );
    });

    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(4);
    expect(screen.getByText("Removed item 1")).toBeInTheDocument();
  });

  it("shows a save-failure error even when three Undo toasts are live", () => {
    // Review finding: with [undo, undo, undo, error] the old trim evicted the
    // only plain toast — the error that was just added — so it never rendered.
    const toast = renderToasts();
    act(() => {
      toast().show("Removed item 1", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("Removed item 2", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("Removed item 3", { actionLabel: "Undo", onAction: vi.fn() });
      toast().error("Your last change to “Camping” didn't save.");
    });

    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(3);
    expect(
      screen.getByText("Your last change to “Camping” didn't save.")
    ).toBeInTheDocument();
  });

  it("never drops the toast being added, even a plain one", () => {
    const toast = renderToasts();
    act(() => {
      toast().show("Removed item 1", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("Removed item 2", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("Removed item 3", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("Moved to Front wall · B3");
    });

    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(3);
    expect(screen.getByText("Moved to Front wall · B3")).toBeInTheDocument();
  });

  it("keeps every error when removals fail offline, interleaved with Undos", () => {
    // Review scenario: U1,E1,U2,E2,U3,E3 — errors are protected like Undos,
    // so none of the "didn't save" messages are swallowed.
    const toast = renderToasts();
    act(() => {
      for (let i = 1; i <= 3; i++) {
        toast().show(`Removed item ${i}`, { actionLabel: "Undo", onAction: vi.fn() });
        toast().error(`Couldn't save change ${i}`);
      }
    });

    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(3);
    for (let i = 1; i <= 3; i++) {
      expect(screen.getByText(`Couldn't save change ${i}`)).toBeInTheDocument();
    }
  });

  it("evicts older plain toasts but not the newest when protected toasts shift indices", () => {
    // [undo, undo, undo, plain, undo, plain-new]: the old plain toast goes,
    // the one just added stays even though splicing shifted its index.
    const toast = renderToasts();
    act(() => {
      toast().show("u1", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("u2", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("u3", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("old plain");
      toast().show("u4", { actionLabel: "Undo", onAction: vi.fn() });
      toast().show("new plain");
    });

    expect(screen.queryByText("old plain")).not.toBeInTheDocument();
    expect(screen.getByText("new plain")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(4);
  });

  it("still caps plain toasts at three, dropping the oldest", () => {
    const toast = renderToasts();
    act(() => {
      ["a", "b", "c", "d"].forEach((m) => toast().show(m));
    });
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("d")).toBeInTheDocument();
  });

  it("an Undo toast still leaves on its own timer", () => {
    vi.useFakeTimers();
    try {
      const toast = renderToasts();
      act(() => {
        toast().show("Removed “Rope”", { actionLabel: "Undo", onAction: vi.fn() });
      });
      expect(screen.getByText("Removed “Rope”")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(6100);
      });
      expect(screen.queryByText("Removed “Rope”")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
