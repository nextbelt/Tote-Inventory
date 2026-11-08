import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RelativeTime from "../RelativeTime";

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a <time> with the ISO value and the exact time as its title", () => {
    render(<RelativeTime date="2026-11-08T11:55:00Z" />);
    const el = screen.getByText("5 min ago");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", "2026-11-08T11:55:00.000Z");
    expect(el.getAttribute("title")).toMatch(/2026/);
  });

  it("keeps counting while the screen stays open", () => {
    render(<RelativeTime date="2026-11-08T11:55:00Z" />);
    expect(screen.getByText("5 min ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(screen.getByText("6 min ago")).toBeInTheDocument();
  });

  it("refreshes immediately when the app returns to the foreground", () => {
    render(<RelativeTime date="2026-11-08T11:55:00Z" />);
    // Phone slept for 2 hours: the clock moved but no interval fired
    vi.setSystemTime(new Date("2026-11-08T14:00:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("2 hr ago")).toBeInTheDocument();
  });

  it("renders nothing for an invalid date", () => {
    const { container } = render(<RelativeTime date="garbage" />);
    expect(container).toBeEmptyDOMElement();
  });
});
