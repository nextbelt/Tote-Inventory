import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TidyUpBanner from "../TidyUpBanner";

const dupTotes = [
  { id: 1, name: "Old Copy", position: "A2", updated_at: "2026-01-01", items: [] },
  { id: 2, name: "Current", position: "A2", updated_at: "2026-06-01", items: [] },
  { id: 3, name: "Paint", position: "C4", updated_at: "2026-01-01", items: [] },
];

const mockLoadData = vi.fn();
vi.mock("../../hooks/useTotes", () => ({
  useTotes: () => ({
    totes: dupTotes,
    totesByPosition: { A2: dupTotes[1], C4: dupTotes[2] },
    source: "cloud",
    loadData: mockLoadData,
  }),
}));

vi.mock("../../services/toteService", () => ({
  toteService: {
    cleanupDuplicates: vi.fn().mockResolvedValue(1),
    migrateEmbeddedPhotos: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../Toast", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

describe("TidyUpBanner", () => {
  it("offers cleanup when hidden duplicates exist, and only deletes the older ids", async () => {
    const { toteService } = await import("../../services/toteService");
    const user = userEvent.setup();
    render(<TidyUpBanner />);

    expect(screen.getByText(/1 hidden duplicate record/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /review/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/keeps “Current”/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /remove 1 hidden duplicate/i })
    );

    await waitFor(() => expect(toteService.cleanupDuplicates).toHaveBeenCalled());
    const groups = toteService.cleanupDuplicates.mock.calls[0][0];
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe(2);
    expect(groups[0].older.map((t) => t.id)).toEqual([1]);
    expect(mockLoadData).toHaveBeenCalled();
  });
});
