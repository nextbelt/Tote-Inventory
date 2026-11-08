import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToteProvider, useTotes } from "../useTotes";

// Local (localStorage) mode — the Supabase module is aliased to null in tests.
const STORE = "totes-inventory";
const T0 = "2026-01-01T00:00:00.000Z";
const camping = {
  id: 1,
  name: "Camping Gear",
  position: "B3",
  items: [{ id: "i1", name: "Lantern", qty: 2 }],
  created_at: T0,
  updated_at: T0,
};

const wrapper = ({ children }) => <ToteProvider>{children}</ToteProvider>;

async function mount() {
  const hook = renderHook(() => useTotes(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useTotes: recently deleted", () => {
  beforeEach(() => {
    localStorage.setItem(STORE, JSON.stringify([camping]));
  });

  it("exposes deleted, capabilities and the new methods", async () => {
    const { result } = await mount();
    expect(result.current.deleted).toEqual([]);
    expect(result.current.capabilities).toEqual({ tags: true, notes: true, swap: true });
    for (const fn of [
      "swapTotes",
      "restoreDeletedTote",
      "purgeDeletedTote",
      "recordRemovedItems",
      "listRemovedItems",
      "restoreRemovedItem",
    ]) {
      expect(typeof result.current[fn]).toBe("function");
    }
  });

  it("Undo after delete restores the SAME tote (id and created_at kept)", async () => {
    const { result } = await mount();
    const snapshot = { id: 1, name: "Camping Gear", position: "B3", items: camping.items };

    await act(() => result.current.deleteTote(1));
    expect(result.current.totes).toEqual([]);
    expect(result.current.deleted.map((d) => d.id)).toEqual([1]);

    let restored;
    await act(async () => {
      restored = await result.current.restoreTote(snapshot);
    });
    expect(restored.id).toBe(1);
    expect(restored.created_at).toBe(T0);
    expect(result.current.totes.map((t) => t.id)).toEqual([1]);
    expect(result.current.deleted).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORE))).toHaveLength(1);
  });

  it("an id-less snapshot (today's DetailPage shape) still restores the just-deleted tombstone", async () => {
    const { result } = await mount();
    await act(() => result.current.deleteTote(1));
    let a;
    await act(async () => {
      a = await result.current.restoreTote({ name: "Camping Gear", position: "B3", items: [] });
    });
    expect(a.id).toBe(1);
    expect(a.created_at).toBe(T0);
    expect(result.current.deleted).toEqual([]); // no stale duplicate left in the bin
  });

  it("falls back to re-creating when no tombstone matches or it was purged", async () => {
    const { result } = await mount();
    await act(() => result.current.deleteTote(1));

    // Different name/spot → nothing matches → re-create
    let a;
    await act(async () => {
      a = await result.current.restoreTote({ name: "Other", position: "A1", items: [] });
    });
    expect(a.id).not.toBe(1);
    expect(result.current.totes.map((t) => t.position)).toEqual(["A1"]);
    expect(result.current.deleted.map((d) => d.id)).toEqual([1]);

    // Tombstone purged → re-create even with an id
    await act(() => result.current.purgeDeletedTote(1));
    expect(result.current.deleted).toEqual([]);
    let b;
    await act(async () => {
      b = await result.current.restoreTote({ id: 1, name: "Again", position: "B3", items: [] });
    });
    expect(b.id).not.toBe(1);
    expect(b.position).toBe("B3");
  });

  it("a taken slot is reported, not silently re-created", async () => {
    const { result } = await mount();
    await act(() => result.current.deleteTote(1));
    await act(() => result.current.saveTote({ name: "Squatter", position: "B3", items: [] }, true));
    await expect(
      act(() => result.current.restoreTote({ id: 1, name: "Camping Gear", position: "B3", items: [] }))
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    expect(result.current.deleted.map((d) => d.id)).toEqual([1]);
  });

  it("swapTotes updates both totes in state", async () => {
    localStorage.setItem(
      STORE,
      JSON.stringify([camping, { ...camping, id: 2, name: "Sports", position: "C4", items: [] }])
    );
    const { result } = await mount();
    await act(() => result.current.swapTotes(1, 2));
    expect(result.current.totesByPosition.B3.id).toBe(2);
    expect(result.current.totesByPosition.C4.id).toBe(1);
  });
});
