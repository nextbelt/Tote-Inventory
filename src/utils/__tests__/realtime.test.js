import { describe, expect, it } from "vitest";
import { applyRealtimeChange } from "../realtime";

const camping = { id: 1, name: "Camping Gear", position: "B3", items: [] };
const sports = { id: 2, name: "Sports", position: "C4", items: [] };
const totes = [camping, sports];

describe("applyRealtimeChange", () => {
  it("INSERT adds, UPDATE replaces, DELETE removes", () => {
    const fresh = { id: 3, name: "Paint", position: "A1", items: [] };
    expect(applyRealtimeChange(totes, { eventType: "INSERT", new: fresh })).toEqual([
      camping,
      sports,
      fresh,
    ]);
    const renamed = { ...camping, name: "Camp" };
    expect(applyRealtimeChange(totes, { eventType: "UPDATE", new: renamed, old: { id: 1 } })).toEqual(
      [renamed, sports]
    );
    expect(applyRealtimeChange(totes, { eventType: "DELETE", old: { id: 2 } })).toEqual([camping]);
  });

  it("an UPDATE into a reserved position is a removal (soft delete, mid-swap)", () => {
    const tomb = { ...camping, position: "__deleted__:B3:1" };
    expect(applyRealtimeChange(totes, { eventType: "UPDATE", new: tomb, old: { id: 1 } })).toEqual([
      sports,
    ]);
    const parked = { ...camping, position: "__swap__:1:2:20261108" };
    expect(applyRealtimeChange(totes, { eventType: "UPDATE", new: parked })).toEqual([sports]);
  });

  it("an INSERT of a reserved row never lands on the walls", () => {
    const bin = { id: 9, position: "__removed_items__", items: [] };
    const config = { id: 10, position: "__config__", items: { leftShelves: 3 } };
    expect(applyRealtimeChange(totes, { eventType: "INSERT", new: bin })).toBe(totes);
    expect(applyRealtimeChange(totes, { eventType: "INSERT", new: config })).toBe(totes);
  });

  it("restoring (UPDATE from a tombstone to a real spot) adds the tote back", () => {
    const back = { ...camping, position: "A1" };
    expect(applyRealtimeChange([sports], { eventType: "UPDATE", new: back, old: { id: 1 } })).toEqual(
      [sports, back]
    );
  });

  it("ignores malformed payloads and keeps the reference when nothing changes", () => {
    expect(applyRealtimeChange(totes, null)).toBe(totes);
    expect(applyRealtimeChange(totes, { eventType: "UPDATE" })).toBe(totes);
    expect(applyRealtimeChange(totes, { eventType: "DELETE", old: { id: 99 } })).toBe(totes);
    expect(applyRealtimeChange(undefined, { eventType: "DELETE", old: { id: 1 } })).toEqual([]);
  });
});
