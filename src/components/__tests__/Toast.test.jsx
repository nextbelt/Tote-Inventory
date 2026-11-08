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
