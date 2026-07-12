import { describe, expect, it } from "vitest";
import { toteService } from "../toteService";

// Local (localStorage) mode — the Supabase module is aliased to null in tests.

describe("layout settings (local mode)", () => {
  it("returns null layout when none was saved", async () => {
    const { layout } = await toteService.getTotes();
    expect(layout).toBeNull();
  });

  it("round-trips saved shelf counts", async () => {
    await toteService.saveLayout({ leftShelves: 7, rightShelves: 3 });
    const { layout } = await toteService.getTotes();
    expect(layout).toEqual({ leftShelves: 7, rightShelves: 3 });
  });

  it("layout settings never appear as a tote", async () => {
    await toteService.saveLayout({ leftShelves: 6, rightShelves: 6 });
    const { data } = await toteService.getTotes();
    expect(data.every((t) => t.position !== "__config__")).toBe(true);
  });
});
